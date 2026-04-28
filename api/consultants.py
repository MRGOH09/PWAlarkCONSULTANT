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
            
            if not all([app_id, app_secret, base_token, table_id]):
                self.send_error(500, "缺少必要的环境变量")
                return
            
            # 获取 Tenant Access Token
            tenant_token = self.get_tenant_access_token(app_id, app_secret)
            if not tenant_token:
                self.send_error(500, "获取访问令牌失败")
                return
            
            # 获取多维表格数据
            consultants_data = self.get_consultants_data(tenant_token, base_token, table_id)
            
            # 设置响应头
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Cache-Control', 'public, max-age=300')  # 缓存 5 分钟
            self.end_headers()
            
            # 返回 JSON 数据
            self.wfile.write(json.dumps(consultants_data, ensure_ascii=False).encode('utf-8'))
            
        except Exception as e:
            print(f"API Error: {str(e)}")
            self.send_error(500, f"服务器错误: {str(e)}")
    
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
                print(f"获取令牌失败: {result}")
                return None
        except Exception as e:
            print(f"请求令牌时出错: {str(e)}")
            return None
    
    def get_consultants_data(self, tenant_token, base_token, table_id):
        """获取顾问工作时间数据"""
        url = f"https://open.jp.larksuite.com/open-apis/bitable/v1/apps/{base_token}/tables/{table_id}/records"
        headers = {
            "Authorization": f"Bearer {tenant_token}",
            "Content-Type": "application/json; charset=utf-8"
        }
        
        try:
            response = requests.get(url, headers=headers, timeout=15)
            response.raise_for_status()
            result = response.json()
            
            if result.get("code") == 0:
                return self.process_consultants_data(result.get("data", {}).get("items", []))
            else:
                print(f"获取数据失败: {result}")
                return []
        except Exception as e:
            print(f"请求数据时出错: {str(e)}")
            return []
    
    def process_consultants_data(self, raw_data):
        """处理和清洗 Lark 返回的原始数据"""
        processed_consultants = []
        
        print(f"原始数据条数: {len(raw_data)}")  # 调试信息
        
        for i, item in enumerate(raw_data):
            fields = item.get("fields", {})
            print(f"记录 {i+1} 字段: {list(fields.keys())}")  # 调试信息
            
            try:
                # 直接按字段顺序提取数据
                field_values = list(fields.values())
                
                if len(field_values) >= 5:
                    # 假设字段顺序为：星期、老师、进、出、校区
                    day = self.extract_value(field_values[0])
                    teachers = self.extract_teachers(field_values[1])
                    checkin = self.extract_value(field_values[2]) 
                    checkout = self.extract_value(field_values[3])
                    campus = self.extract_value(field_values[4])
                    
                    print(f"提取的数据: day={day}, teachers={teachers}, checkin={checkin}, checkout={checkout}, campus={campus}")
                    
                    # 只处理有效数据
                    if day and teachers and checkin and checkout and campus:
                        consultant = {
                            "day": day,
                            "teachers": teachers,
                            "checkin": checkin,
                            "checkout": checkout,
                            "campus": campus
                        }
                        processed_consultants.append(consultant)
                        
            except Exception as e:
                print(f"处理单条记录时出错: {str(e)}")
                continue
        
        print(f"处理完成，有效记录数: {len(processed_consultants)}")
        return processed_consultants
    
    def extract_value(self, field_data):
        """提取字段值"""
        if isinstance(field_data, dict):
            if "text" in field_data:
                return field_data["text"]
            elif "value" in field_data:
                return str(field_data["value"])
        elif isinstance(field_data, (str, int, float)):
            return str(field_data)
        return ""
    
    def extract_teachers(self, field_data):
        """提取老师字段（可能是多选）"""
        if isinstance(field_data, list):
            names = []
            for item in field_data:
                if isinstance(item, dict) and "text" in item:
                    names.append(item["text"])
                elif isinstance(item, str):
                    names.append(item)
            return names if names else ["未知"]
        elif isinstance(field_data, dict) and "text" in field_data:
            return [field_data["text"]]
        elif isinstance(field_data, str):
            return [field_data]
        return ["未知"]