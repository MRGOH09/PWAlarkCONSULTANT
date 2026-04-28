import json
import os
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
            if not record_id:
                self.send_json_response({"error": "缺少 recordId"}, 400)
                return

            tenant_token = self.get_tenant_access_token(app_id, app_secret)
            if not tenant_token:
                self.send_json_response({"error": "获取访问令牌失败"}, 500)
                return

            result = self.delete_record(tenant_token, base_token, table_id, record_id)
            if result.get("code") == 0:
                self.send_json_response({"ok": True})
            else:
                self.send_json_response({
                    "ok": False,
                    "error": result.get("msg", "删除失败"),
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

    def delete_record(self, tenant_token, base_token, table_id, record_id):
        url = f"https://open.larksuite.com/open-apis/bitable/v1/apps/{base_token}/tables/{table_id}/records/{record_id}"
        headers = {"Authorization": f"Bearer {tenant_token}"}
        try:
            response = requests.delete(url, headers=headers, timeout=15)
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
