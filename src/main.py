import scrypted_sdk
from typing import Any, Optional, List, Dict
import asyncio
import json

from owlet_auth import OwletAuth
from owlet_camera import OwletCamera

class OwletPlugin(scrypted_sdk.ScryptedDeviceBase, scrypted_sdk.DeviceProvider, scrypted_sdk.Settings):
    def __init__(self, nativeId: Optional[str] = None):
        super().__init__(nativeId)
        
        self.auth = OwletAuth()
        self.cameras: Dict[str, Any] = {}
        
        # Auto-discover on startup
        asyncio.create_task(self.startup_discovery())
    
    async def startup_discovery(self):
        """Run device discovery on startup if credentials exist"""
        email = self.storage.getItem('email')
        password = self.storage.getItem('password')
        
        if email and password:
            print(f"Auto-discovering devices for {email}")
            await self.discover_devices()
    
    async def getSettings(self) -> List[Dict[str, Any]]:
        """Return settings schema"""
        return [
            {
                "key": "email",
                "title": "Owlet Email",
                "type": "string",
                "value": self.storage.getItem('email') or '',
            },
            {
                "key": "password",
                "title": "Owlet Password",
                "type": "password",
                "value": self.storage.getItem('password') or '',
            },
            {
                "key": "refreshInterval",
                "title": "Device Refresh Interval (minutes)",
                "type": "number",
                "value": int(self.storage.getItem('refreshInterval') or '5'),
            },
            {
                "key": "manualCameraId",
                "title": "Manual Camera Device ID (optional)",
                "type": "string",
                "value": self.storage.getItem('manualCameraId') or '',
            }
        ]
    
    async def putSetting(self, key: str, value: Any):
        """Save settings and trigger discovery"""
        self.storage.setItem(key, str(value))
        
        if key in ['email', 'password']:
            email = self.storage.getItem('email')
            password = self.storage.getItem('password')
            
            if email and password:
                await self.auth.login(email, password)
                await self.discover_devices()
        elif key == 'manualCameraId':
            # Re-discover devices when manual camera ID changes
            await self.discover_devices()
    
    async def discover_devices(self) -> List[Dict[str, Any]]:
        """Discover Owlet cameras"""
        print("Starting device discovery...")
        
        # Authenticate
        email = self.storage.getItem('email')
        password = self.storage.getItem('password')
        
        if not email or not password:
            print("Owlet credentials not configured - skipping device discovery")
            return []
        
        print(f"Authenticating with Owlet API using email: {email}")
        
        # Authenticate with Owlet API using Firebase
        jwt = await self.auth.login(email, password)
        account_id = self.auth.get_account_id()
        
        if not jwt or not account_id:
            print("Failed to authenticate with Owlet API - no JWT token or account ID received")
            return []
        
        print(f"Successfully authenticated with Owlet API (Account ID: {account_id})")
        
        # Get devices from Owlet API
        devices = await self.auth.get_devices(jwt, account_id)
        
        print(f"Discovered {len(devices) if devices else 0} Owlet devices from API")
        
        # Handle case where devices might be null or undefined
        if not devices or not isinstance(devices, list):
            print("Invalid devices response:", devices)
            print("Devices is not an array, returning empty list")
            return []
        
        # Check if we found any cameras
        cameras = [device for device in devices if 
                  device.get('type') == 'camera' or 
                  device.get('deviceType') == 'CAMERA' or
                  device.get('id', '').startswith('OCA')]
        
        print(f"Found {len(cameras)} cameras from API")
        
        # If no cameras found, try fallback methods
        if len(cameras) == 0:
            print("No cameras found via API, trying fallback methods...")
            
            # Try hardcoded camera
            hardcoded_camera_id = 'OCA1234567890123'
            print(f"Checking hardcoded camera: {hardcoded_camera_id}")
            
            try:
                credentials = await self.auth.get_tutk_credentials(jwt, hardcoded_camera_id)
                if credentials:
                    print(f"Found hardcoded camera {hardcoded_camera_id} with TUTK credentials")
                    
                    hardcoded_camera = {
                        'id': hardcoded_camera_id,
                        'name': 'Owlet Camera',
                        'type': 'camera',
                        'deviceType': 'CAMERA',
                        'status': 'online',
                        'serialNumber': hardcoded_camera_id,
                        'firmwareVersion': 'unknown'
                    }
                    
                    devices.append(hardcoded_camera)
                    
                    # Store device data for later use
                    device_data = {
                        'deviceId': hardcoded_camera_id,
                        'name': 'Owlet Camera',
                        'tutkId': credentials['tutkid'],
                        'tutkUsername': credentials['password'],
                        'tutkPassword': credentials['password'],
                        'authKey': credentials['authKey'],
                        'status': 'online'
                    }
                    
                    self.storage.setItem(f"device_{hardcoded_camera_id}", json.dumps(device_data))
                    print(f"Stored device data for {hardcoded_camera_id}")
            except Exception as e:
                print(f"Hardcoded camera {hardcoded_camera_id} not found: {str(e)}")
            
            # Try manual camera ID from settings
            manual_camera_id = self.storage.getItem('manualCameraId')
            if manual_camera_id and manual_camera_id.strip():
                print(f"Checking manual camera ID: {manual_camera_id}")
                try:
                    credentials = await self.auth.get_tutk_credentials(jwt, manual_camera_id)
                    if credentials:
                        print(f"Found manual camera {manual_camera_id} with TUTK credentials")
                        
                        manual_camera = {
                            'id': manual_camera_id,
                            'name': 'Manual Owlet Camera',
                            'type': 'camera',
                            'deviceType': 'CAMERA',
                            'status': 'online',
                            'serialNumber': manual_camera_id,
                            'firmwareVersion': 'unknown'
                        }
                        
                        devices.append(manual_camera)
                        
                        # Store device data for later use
                        device_data = {
                            'deviceId': manual_camera_id,
                            'name': 'Manual Owlet Camera',
                            'tutkId': credentials['tutkid'],
                            'tutkUsername': credentials['password'],
                            'tutkPassword': credentials['password'],
                            'authKey': credentials['authKey'],
                            'status': 'online'
                        }
                        
                        self.storage.setItem(f"device_{manual_camera_id}", json.dumps(device_data))
                        print(f"Stored device data for {manual_camera_id}")
                except Exception as e:
                    print(f"Manual camera {manual_camera_id} not found: {str(e)}")
        
        discovered_devices = []
        camera_count = 0
        
        # Return Device descriptors for Scrypted to create devices
        for device_data in devices:
            if device_data.get('type') == 'camera':
                camera_count += 1
                native_id = device_data['id']
                
                # Create Device descriptor for Scrypted
                device = {
                    "nativeId": native_id,
                    "name": device_data['name'],
                    "type": scrypted_sdk.ScryptedDeviceType.Camera.value,
                    "interfaces": [
                        scrypted_sdk.ScryptedInterface.Camera.value,
                        scrypted_sdk.ScryptedInterface.VideoCamera.value,
                        scrypted_sdk.ScryptedInterface.Settings.value,
                        scrypted_sdk.ScryptedInterface.Online.value,
                    ]
                }
                
                discovered_devices.append(device)
                print(f"Discovered Owlet camera: {device_data['name']} ({native_id}) - Status: {device_data.get('status', 'unknown')}")
        
        print(f"Processed {camera_count} camera devices")
        print('Returning devices:', json.dumps(discovered_devices, indent=2))
        
        # CRITICAL: Notify Scrypted that devices changed
        if discovered_devices:
            print('Notifying Scrypted of device changes...')
            await scrypted_sdk.deviceManager.onDevicesChanged({
                'devices': discovered_devices
            })
            print('Scrypted notified of device changes')
        
        return discovered_devices
    
    async def getDevice(self, nativeId: str) -> Any:
        """Get camera device instance"""
        print(f"getDevice called for: {nativeId}")
        
        # Return existing instance if available
        if nativeId in self.cameras:
            print(f"Returning existing camera instance for {nativeId}")
            return self.cameras[nativeId]
        
        # Load device data from storage
        device_data_str = self.storage.getItem(f"device_{nativeId}")
        if not device_data_str:
            print(f"No device data found for {nativeId}")
            return None
        
        try:
            device_data = json.loads(device_data_str)
            print(f"Loaded device data for {nativeId}:", {
                'deviceId': device_data.get('deviceId'),
                'name': device_data.get('name'),
                'tutkId': device_data.get('tutkId'),
                'status': device_data.get('status')
            })
            
            # Create camera instance
            camera = OwletCamera(nativeId, device_data, self.auth)
            self.cameras[nativeId] = camera
            
            print(f"Created OwletCamera instance for {nativeId}: {device_data.get('name')}")
            return camera
            
        except Exception as e:
            print(f"Failed to parse device data for {nativeId}: {str(e)}")
            return None
    
    async def releaseDevice(self, id: str, nativeId: str):
        """Release device resources"""
        device = self.cameras.get(nativeId)
        if device:
            await device.cleanup()
            del self.cameras[nativeId]
    
    async def getDevices(self) -> List[Dict[str, Any]]:
        """Return Device descriptors for all discovered cameras"""
        devices = []
        
        # Get current device list from API to ensure we have the latest state
        try:
            email = self.storage.getItem('email')
            password = self.storage.getItem('password')
            
            if email and password:
                jwt = await self.auth.login(email, password)
                account_id = self.auth.get_account_id()
                
                if jwt and account_id:
                    api_devices = await self.auth.get_devices(jwt, account_id)
                    cameras = [device for device in api_devices if 
                              device.get('type') == 'camera' or 
                              device.get('deviceType') == 'CAMERA' or
                              device.get('id', '').startswith('OCA')]
                    
                    for device_data in cameras:
                        devices.append({
                            "nativeId": device_data['id'],
                            "name": device_data['name'],
                            "type": scrypted_sdk.ScryptedDeviceType.Camera.value,
                            "interfaces": [
                                scrypted_sdk.ScryptedInterface.Camera.value,
                                scrypted_sdk.ScryptedInterface.VideoCamera.value,
                                scrypted_sdk.ScryptedInterface.Settings.value,
                                scrypted_sdk.ScryptedInterface.Online.value,
                            ]
                        })
        except Exception as e:
            print(f"Failed to get current device list: {str(e)}")
        
        return devices

def create_scrypted_plugin():
    return OwletPlugin()
