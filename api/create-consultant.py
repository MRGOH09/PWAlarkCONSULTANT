import json
import os
import re
from http.server import BaseHTTPRequestHandler
import requests


VALID_DAYS = {"星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"}
SELECT_FIELD_TYPE = 3
SINGLE_SELECT_FIELDS_TO_ENSURE = ["老师", "校区", "进 (Check-in)", "出 (Check-out)"]


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
            teacher = str(payload.get("teacher", "")).strip()
            campus = str(payload.get("campus", "")).strip().upper()
            day = str(payload.get("day", "")).strip()
            week = str(payload.get("week", "")).strip() or "全部"
            checkin = str(payload.get("checkin", "")).strip()
            checkout = str(payload.get("checkout", "")).strip()

            if not teacher:
                self.send_json_response({"error": "请选择或输入老师"}, 400)
                return
            if day not in VALID_DAYS:
                self.send_json_response({"error": "星期格式不正确"}, 400)
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
            conflicts = self.find_conflicts(
                existing_records,
                {
                    "recordId": "",
                    "teachers": [teacher],
                    "day": day,
                    "week": week,
                    "checkin": checkin,
                    "checkout": checkout,
                }
            )
            if conflicts:
                self.send_json_response({
                    "ok": False,
                    "error": self.format_conflict_message(conflicts[0]),
                    "conflicts": conflicts
                }, 409)
                return

            fields_schema = self.get_fields(tenant_token, base_token, table_id)
            if not fields_schema:
                self.send_json_response({"error": "无法获取字段 schema"}, 500)
                return

            target_values = {
                "老师": teacher,
                "校区": campus,
                "进 (Check-in)": checkin,
                "出 (Check-out)": checkout,
            }
            for field_name in SINGLE_SELECT_FIELDS_TO_ENSURE:
                ok, err = self.ensure_select_value(
                    tenant_token, base_token, table_id,
                    fields_schema, field_name, target_values[field_name]
                )
                if not ok:
                    self.send_json_response(
                        {"error": f"{field_name} 添加选项失败: {err}"}, 400
                    )
                    return

            fields = {
                "星期": day,
                "老师": teacher,
                "进 (Check-in)": checkin,
                "出 (Check-out)": checkout,
                "校区": campus,
                "适用周": week,
            }
            result = self.create_record(tenant_token, base_token, table_id, fields)

            if result.get("code") == 0:
                record = result.get("data", {}).get("record", {})
                self.send_json_response({"ok": True, "recordId": record.get("record_id", "")})
            else:
                self.send_json_response({
                    "ok": False,
                    "error": result.get("msg", "创建失败"),
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
        data = {"app_id": app_id, "app_secret": app_secret}

        try:
            response = requests.post(url, headers=headers, json=data, timeout=10)
            response.raise_for_status()
            result = response.json()
            if result.get("code") == 0:
                return result.get("tenant_access_token")
        except Exception as e:
            print(f"请求令牌时出错: {str(e)}")
        return None

    def get_fields(self, tenant_token, base_token, table_id):
        url = f"https://open.larksuite.com/open-apis/bitable/v1/apps/{base_token}/tables/{table_id}/fields"
        headers = {"Authorization": f"Bearer {tenant_token}"}
        try:
            response = requests.get(url, headers=headers, timeout=15)
            response.raise_for_status()
            return response.json().get("data", {}).get("items", [])
        except Exception as e:
            print(f"获取字段 schema 失败: {str(e)}")
            return []

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
        return week_a == week_b

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

    def ensure_select_value(self, tenant_token, base_token, table_id,
                            fields_schema, field_name, value):
        """单选字段：若 value 不在选项内则追加。返回 (ok, error)。"""
        field = next((f for f in fields_schema if f.get("field_name") == field_name), None)
        if not field:
            return False, f"字段 {field_name} 不存在"
        if field.get("type") != SELECT_FIELD_TYPE:
            return True, None

        options = (field.get("property") or {}).get("options") or []
        existing_names = {opt.get("name") for opt in options}
        if value in existing_names:
            return True, None

        # 关键：必须保留 id 和 color，否则 Lark 会把旧选项视为新建，
        # 导致已有记录引用的 option_id 失效、字段数据被清空。
        new_options = []
        for opt in options:
            kept = {"name": opt.get("name")}
            if opt.get("id"):
                kept["id"] = opt.get("id")
            if opt.get("color") is not None:
                kept["color"] = opt.get("color")
            new_options.append(kept)
        new_options.append({"name": value})

        url = (
            f"https://open.larksuite.com/open-apis/bitable/v1/apps/"
            f"{base_token}/tables/{table_id}/fields/{field.get('field_id')}"
        )
        headers = {
            "Authorization": f"Bearer {tenant_token}",
            "Content-Type": "application/json; charset=utf-8"
        }
        body = {
            "field_name": field_name,
            "type": SELECT_FIELD_TYPE,
            "property": {"options": new_options}
        }
        try:
            response = requests.put(url, headers=headers, json=body, timeout=15)
            result = response.json()
            if result.get("code") == 0:
                return True, None
            return False, result.get("msg", "未知错误")
        except Exception as e:
            return False, str(e)

    def create_record(self, tenant_token, base_token, table_id, fields):
        url = f"https://open.larksuite.com/open-apis/bitable/v1/apps/{base_token}/tables/{table_id}/records"
        headers = {
            "Authorization": f"Bearer {tenant_token}",
            "Content-Type": "application/json; charset=utf-8"
        }
        data = {"fields": fields}

        try:
            response = requests.post(url, headers=headers, json=data, timeout=15)
            response.raise_for_status()
            return response.json()
        except requests.HTTPError:
            try:
                return response.json()
            except Exception as e:
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
