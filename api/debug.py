import json
import os
from http.server import BaseHTTPRequestHandler
import requests

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            # 获取环境变量
            app_id = os.environ.get('LARK_APP_ID')
            app_secret = os.environ.get('LARK_APP_SECRET')
            base_token = os.environ.get('LARK_BASE_TOKEN')
            table_id = os.environ.get('LARK_TABLE_ID')
            
            debug_info = {
                "app_id": app_id,
                "app_secret": "***" if app_secret else None,
                "base_token": base_token,
                "table_id": table_id
            }
            
            if not all([app_id, app_secret, base_token, table_id]):
                debug_info["error"] = "缺少必要的环境变量"
                self.send_json_response(debug_info)
                return
            
            # 获取 Tenant Access Token
            tenant_token = self.get_tenant_access_token(app_id, app_secret)
            if not tenant_token:
                debug_info["error"] = "获取访问令牌失败"
                self.send_json_response(debug_info)
                return
                
            debug_info["tenant_token"] = "获取成功"
            
            # 获取原始数据
            raw_data = self.get_raw_data(tenant_token, base_token, table_id)
            debug_info["raw_data"] = raw_data
            
            self.send_json_response(debug_info)
            
        except Exception as e:
            error_info = {"error": f"服务器错误: {str(e)}"}
            self.send_json_response(error_info)
    
    def send_json_response(self, data):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False, indent=2).encode('utf-8'))
    
    def get_tenant_access_token(self, app_id, app_secret):
        """获取 Tenant Access Token"""
        url = "https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal"
        headers = {
            "Content-Type": "application/json; charset=utf-8"
        }
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
            else:
                return None
        except Exception as e:
            return None
    
    def get_raw_data(self, tenant_token, base_token, table_id):
        """获取原始数据用于调试"""
        url = f"https://open.larksuite.com/open-apis/bitable/v1/apps/{base_token}/tables/{table_id}/records"
        headers = {
            "Authorization": f"Bearer {tenant_token}",
            "Content-Type": "application/json; charset=utf-8"
        }
        
        try:
            response = requests.get(url, headers=headers, timeout=15)
            response.raise_for_status()
            result = response.json()
            return result
        except Exception as e:
            return {"error": str(e)}