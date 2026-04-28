import json
import os
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

            tenant_token = self.get_tenant_access_token(app_id, app_secret)
            if not tenant_token:
                self.send_json_response({"error": "获取访问令牌失败"}, 500)
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

        new_options = [{"name": opt.get("name")} for opt in options]
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
