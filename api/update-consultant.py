import json
import os
import re
from http.server import BaseHTTPRequestHandler
import requests


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()

    def do_POST(self):
        try:
            app_id = os.environ.get('LARK_APP_ID')
            app_secret = os.environ.get('LARK_APP_SECRET')
            base_token = os.environ.get('LARK_BASE_TOKEN')
            table_id = os.environ.get('LARK_TABLE_ID')

            if not all([app_id, app_secret, base_token, table_id]):
                self.send_json_response({"error": "缺少必要的环境变量"}, 500)
                return

            payload = self.read_json_body()
            record_id = str(payload.get("recordId", "")).strip()
            checkin = str(payload.get("checkin", "")).strip()
            checkout = str(payload.get("checkout", "")).strip()

            if not record_id:
                self.send_json_response({"error": "缺少 recordId"}, 400)
                return

            if not checkin or not checkout:
                self.send_json_response({"error": "进出时间不能为空"}, 400)
                return
            if self.parse_time_to_minutes(checkout) <= self.parse_time_to_minutes(checkin):
                self.send_json_response({"error": "出时间必须晚于进时间"}, 400)
                return

            tenant_token = self.get_tenant_access_token(app_id, app_secret)
            if not tenant_token:
                self.send_json_response({"error": "获取访问令牌失败"}, 500)
                return

            existing_records = self.get_records(tenant_token, base_token, table_id)
            target = next((record for record in existing_records if record.get("recordId") == record_id), None)
            if not target:
                self.send_json_response({"error": "找不到这条排班记录"}, 404)
                return
            target = {**target, "checkin": checkin, "checkout": checkout}
            conflicts = self.find_conflicts(existing_records, target)
            if conflicts:
                self.send_json_response({
                    "ok": False,
                    "error": self.format_conflict_message(conflicts[0]),
                    "conflicts": conflicts
                }, 409)
                return

            result = self.update_record(
                tenant_token,
                base_token,
                table_id,
                record_id,
                {
                    "进 (Check-in)": checkin,
                    "出 (Check-out)": checkout
                }
            )

            if result.get("code") == 0:
                self.send_json_response({"ok": True, "data": result.get("data", {})})
            else:
                self.send_json_response({
                    "ok": False,
                    "error": result.get("msg", "更新失败"),
                    "lark": result
                }, 400)

        except Exception as e:
            self.send_json_response({"error": f"服务器错误: {str(e)}"}, 500)

    def read_json_body(self):
        content_length = int(self.headers.get('Content-Length', 0))
        if content_length <= 0:
            return {}
        raw_body = self.rfile.read(content_length).decode('utf-8')
        return json.loads(raw_body or '{}')

    def get_tenant_access_token(self, app_id, app_secret):
        url = "https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal"
        headers = {"Content-Type": "application/json; charset=utf-8"}
        data = {
            "app_id": app_id,
            "app_secret": app_secret
        }

        try:
            response = requests.post(url, headers=headers, json=data, timeout=10)
            response.raise_for_status()
            result = response.json()
            if result.get("code") == 0:
                return result.get("tenant_access_token")
        except Exception as e:
            print(f"请求令牌时出错: {str(e)}")
        return None

    def get_records(self, tenant_token, base_token, table_id):
        url = f"https://open.larksuite.com/open-apis/bitable/v1/apps/{base_token}/tables/{table_id}/records"
        headers = {"Authorization": f"Bearer {tenant_token}"}
        records = []
        page_token = ""
        try:
            while True:
                params = {"page_size": 500}
                if page_token:
                    params["page_token"] = page_token
                response = requests.get(url, headers=headers, params=params, timeout=15)
                response.raise_for_status()
                result = response.json()
                if result.get("code") != 0:
                    return []

                data = result.get("data", {})
                records.extend(self.normalize_record(item) for item in data.get("items", []))
                if not data.get("has_more"):
                    return records
                page_token = data.get("page_token", "")
                if not page_token:
                    return records
        except Exception as e:
            print(f"获取已有记录失败: {str(e)}")
            return []

    def normalize_record(self, item):
        fields = item.get("fields", {})
        return {
            "recordId": item.get("record_id", ""),
            "day": self.extract_value(fields.get("星期", "")),
            "teachers": self.extract_teachers(fields.get("老师", [])),
            "checkin": self.extract_value(fields.get("进 (Check-in)", "")),
            "checkout": self.extract_value(fields.get("出 (Check-out)", "")),
            "campus": self.extract_value(fields.get("校区", "")),
            "week": self.extract_value(fields.get("适用周", "")) or "全部",
        }

    def extract_value(self, field_data):
        if isinstance(field_data, dict):
            if "text" in field_data:
                return field_data["text"]
            if "value" in field_data:
                return str(field_data["value"])
        if isinstance(field_data, (str, int, float)):
            return str(field_data)
        return ""

    def extract_teachers(self, field_data):
        if isinstance(field_data, list):
            names = []
            for item in field_data:
                if isinstance(item, dict) and "text" in item:
                    names.append(item["text"])
                elif isinstance(item, str):
                    names.append(item)
            return names
        if isinstance(field_data, dict) and "text" in field_data:
            return [field_data["text"]]
        if isinstance(field_data, str):
            return [field_data]
        return []

    def parse_time_to_minutes(self, time_str):
        match = re.search(r"(\d{1,2})(?:[:.](\d{1,2}))?\s*(AM|PM)?", str(time_str or ""), re.I)
        if not match:
            return 0
        hour = int(match.group(1))
        minute = int(match.group(2) or "0")
        period = (match.group(3) or "").lower()
        if period == "pm" and hour != 12:
            hour += 12
        elif period == "am" and hour == 12:
            hour = 0
        return hour * 60 + minute

    def weeks_overlap(self, week_a, week_b):
        return week_a == week_b or week_a == "全部" or week_b == "全部"

    def times_overlap(self, start_a, end_a, start_b, end_b):
        return start_a < end_b and start_b < end_a

    def find_conflicts(self, records, target):
        conflicts = []
        target_teachers = {t.strip().lower() for t in target.get("teachers", []) if t.strip()}
        target_start = self.parse_time_to_minutes(target.get("checkin"))
        target_end = self.parse_time_to_minutes(target.get("checkout"))

        for record in records:
            if record.get("recordId") == target.get("recordId"):
                continue
            if record.get("day") != target.get("day"):
                continue
            if not self.weeks_overlap(record.get("week", "全部"), target.get("week", "全部")):
                continue
            record_teacher_map = {
                t.strip().lower(): t.strip()
                for t in record.get("teachers", [])
                if t.strip()
            }
            shared_teachers = target_teachers.intersection(record_teacher_map.keys())
            if not shared_teachers:
                continue

            record_start = self.parse_time_to_minutes(record.get("checkin"))
            record_end = self.parse_time_to_minutes(record.get("checkout"))
            if self.times_overlap(target_start, target_end, record_start, record_end):
                conflicts.append({
                    **record,
                    "conflictTeachers": [record_teacher_map[key] for key in sorted(shared_teachers)]
                })
        return conflicts

    def format_conflict_message(self, conflict):
        teachers = "、".join(conflict.get("conflictTeachers", []) or conflict.get("teachers", []))
        return (
            f"时间重叠：{teachers} 已有 {conflict.get('week', '全部')} "
            f"{conflict.get('day', '')} {conflict.get('checkin', '')}-{conflict.get('checkout', '')} "
            f"{conflict.get('campus', '')} 排班。请先改掉前面的时间。"
        )

    def update_record(self, tenant_token, base_token, table_id, record_id, fields):
        url = f"https://open.larksuite.com/open-apis/bitable/v1/apps/{base_token}/tables/{table_id}/records/{record_id}"
        headers = {
            "Authorization": f"Bearer {tenant_token}",
            "Content-Type": "application/json; charset=utf-8"
        }
        data = {"fields": fields}

        try:
            response = requests.put(url, headers=headers, json=data, timeout=15)
            response.raise_for_status()
            return response.json()
        except requests.HTTPError as e:
            try:
                return response.json()
            except Exception:
                return {"code": -1, "msg": str(e)}
        except Exception as e:
            return {"code": -1, "msg": str(e)}

    def send_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def send_json_response(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_cors_headers()
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode('utf-8'))
