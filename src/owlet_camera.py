import scrypted_sdk
from typing import Any, Dict, Optional
import asyncio
import json
import tempfile
import os
import subprocess
import time
from aiohttp import web
import logging

class OwletProxyServer:
    """Local HTTP proxy server on port 8969"""
    
    def __init__(self, camera):
        self.camera = camera
        self.port = 8969
        self.app = None
        self.runner = None
        self.site = None
        logging.info(f"Proxy server initialized for {camera.name}")
        
    async def handle_stream(self, request):
        """Handle GET /stream requests"""
        logging.info(f"📺 Stream request received for {self.camera.name}")
        
        response = web.StreamResponse(
            status=200,
            headers={
                'Content-Type': 'video/mp4',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            }
        )
        
        await response.prepare(request)
        
        try:
            # TODO: Replace with actual P2P stream
            # For now, just log that we got here
            logging.info("Stream endpoint reached - P2P implementation needed")
            
            # Keep connection open for testing
            while True:
                await asyncio.sleep(1)
                
        except asyncio.CancelledError:
            logging.info("Stream cancelled")
        except Exception as e:
            logging.error(f"Stream error: {e}", exc_info=True)
        finally:
            await response.write_eof()
        
        return response
    
    async def start(self):
        """Start the proxy server"""
        if self.runner:
            logging.info("Proxy already running")
            return
            
        self.app = web.Application()
        self.app.router.add_get('/stream', self.handle_stream)
        
        self.runner = web.AppRunner(self.app)
        await self.runner.setup()
        
        self.site = web.TCPSite(self.runner, '0.0.0.0', self.port)
        await self.site.start()
        
        logging.info(f"✅ Proxy server started on http://localhost:{self.port}/stream")
    
    async def stop(self):
        """Stop the proxy server"""
        if self.site:
            await self.site.stop()
        if self.runner:
            await self.runner.cleanup()
        logging.info("Proxy server stopped")


class OwletCamera(scrypted_sdk.ScryptedDeviceBase):
    def __init__(self, nativeId: str, device_data: Dict[str, Any], auth: Any):
        super().__init__(nativeId)
        
        self.device_data = device_data
        self.auth = auth
        self.name = device_data.get('name', 'Owlet Camera')
        self.nativeId = nativeId
        self.proxy = OwletProxyServer(self)
        
        # TUTK credentials
        self.tutk_credentials = None
        
        # Stream management
        self.is_streaming = False
        self.current_quality = 'HD'
        self.stream_timeout = 300  # 5 minutes
        self.motion_detection = True
        
        # Connection management
        self.max_connections = 3
        self.active_connections = 0
        self.connection_pool: Dict[str, Any] = {}
        
        # Error recovery
        self.reconnect_delay = 1000  # Start with 1 second
        self.max_reconnect_attempts = 5
        self.last_reconnect_time = 0
        
        # Load TUTK credentials
        asyncio.create_task(self.load_tutk_credentials())
    
    async def load_tutk_credentials(self):
        """Load TUTK credentials for this camera"""
        try:
            print(f"Loading TUTK credentials for camera {self.name} ({self.device_data.get('deviceId')})")
            
            # Ensure we have a valid token
            jwt = await self.auth.ensure_valid_token()
            if not jwt:
                print("No valid JWT token available for TUTK credentials")
                raise Exception('Authentication required. Please check your Owlet credentials.')

            self.tutk_credentials = await self.auth.get_tutk_credentials(jwt, self.device_data.get('deviceId'))
            print(f"Successfully loaded TUTK credentials for {self.name} (TUTK ID: {self.tutk_credentials.get('tutkid')})")
        except Exception as e:
            print(f"Failed to load TUTK credentials for {self.name}: {str(e)}")
            
            # Handle specific error cases
            if 'Camera' in str(e) and 'not found' in str(e):
                raise Exception(f"Camera {self.name} is offline or not accessible. Please check the camera's power and network connection.")
            elif 'Authentication expired' in str(e):
                raise Exception('Authentication expired. Please check your Owlet credentials.')
            elif 'Network error' in str(e):
                raise Exception('Network error: Unable to connect to Owlet servers. Please check your internet connection.')
            else:
                raise e

    async def getVideoStream(self, options: Optional[Dict[str, Any]] = None) -> Any:
        """Return stream URL from local proxy"""
        logging.info(f"📹 Getting video stream for {self.name}")
        
        # Start proxy server
        await self.proxy.start()
        
        # Return URL to proxy
        stream_url = f"http://localhost:{self.proxy.port}/stream"
        
        logging.info(f"✅ Returning stream URL: {stream_url}")
        
        # Create media object
        return await scrypted_sdk.mediaManager.createMediaObject(
            stream_url.encode(),
            "text/x-uri"
        )

    async def create_tutk_connection(self, quality: str) -> Dict[str, Any]:
        """Create a TUTK connection for streaming"""
        if not self.tutk_credentials:
            raise Exception('TUTK credentials not available')

        tutkid = self.tutk_credentials['tutkid']
        password = self.tutk_credentials['password']
        auth_key = self.tutk_credentials['authKey']
        
        # Create a temporary file for the stream
        temp_dir = tempfile.gettempdir()
        stream_file = os.path.join(temp_dir, f'owlet_{self.device_data.get("deviceId")}_{quality}_stream.m3u8')
        
        # Clean up any existing stream file
        if os.path.exists(stream_file):
            os.unlink(stream_file)

        # Get quality settings
        quality_settings = self.get_quality_settings(quality)
        
        # Start TUTK client process
        tutk_args = [
            '--uid', tutkid,
            '--password', password,
            '--authkey', auth_key,
            '--output', stream_file,
            '--format', 'hls',
            '--video-codec', 'h264',
            '--audio-codec', 'aac',
            '--width', str(quality_settings['width']),
            '--height', str(quality_settings['height']),
            '--bitrate', str(quality_settings['bitrate']),
            '--fps', str(quality_settings['fps'])
        ]

        print(f"Starting TUTK client for {tutkid} at {quality} quality")
        
        # Spawn TUTK client process
        process = subprocess.Popen(
            ['tutk-client'] + tutk_args,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )

        # Create connection pool entry
        connection = {
            'process': process,
            'streamUrl': None,
            'quality': quality,
            'lastUsed': time.time(),
            'isActive': False,
            'reconnectAttempts': 0
        }

        # Wait for stream file to be created
        attempts = 0
        max_attempts = 30  # 30 seconds timeout
        
        while attempts < max_attempts:
            if os.path.exists(stream_file):
                connection['streamUrl'] = f'file://{stream_file}'
                connection['isActive'] = True
                print(f"TUTK stream started for {quality}: {connection['streamUrl']}")
                return connection
            
            await asyncio.sleep(1)
            attempts += 1

        raise Exception(f"Timeout waiting for TUTK stream to start for {quality}")

    def get_quality_settings(self, quality: str) -> Dict[str, Any]:
        """Get quality settings for streaming"""
        qualities = {
            'LD': {'id': 'LD', 'name': 'Low Definition', 'width': 640, 'height': 480, 'bitrate': 500000, 'fps': 15},
            'SD': {'id': 'SD', 'name': 'Standard Definition', 'width': 1280, 'height': 720, 'bitrate': 1000000, 'fps': 20},
            'HD': {'id': 'HD', 'name': 'High Definition', 'width': 1920, 'height': 1080, 'bitrate': 2000000, 'fps': 30},
            '2K': {'id': '2K', 'name': '2K Resolution', 'width': 2560, 'height': 1440, 'bitrate': 4000000, 'fps': 30}
        }
        
        return qualities.get(quality, qualities['HD'])

    async def handle_stream_error(self, error: Exception, quality: str):
        """Handle streaming errors with reconnection logic"""
        print(f"Stream error for {quality}: {str(error)}")
        
        connection = self.connection_pool.get(quality)
        if connection:
            connection['isActive'] = False
            connection['reconnectAttempts'] += 1
            
            if connection['reconnectAttempts'] < self.max_reconnect_attempts:
                print(f"Attempting to reconnect {quality} stream (attempt {connection['reconnectAttempts']})")
                await self.reconnect_with_backoff(quality)
            else:
                print(f"Max reconnection attempts reached for {quality} stream")
                del self.connection_pool[quality]

    async def reconnect_with_backoff(self, quality: str):
        """Reconnect with exponential backoff"""
        delay = min(self.reconnect_delay * (2 ** self.last_reconnect_time), 30000)  # Max 30 seconds
        self.last_reconnect_time += 1
        
        print(f"Reconnecting {quality} stream in {delay}ms")
        
        await asyncio.sleep(delay / 1000)  # Convert to seconds
        
        try:
            connection = await self.create_tutk_connection(quality)
            self.connection_pool[quality] = connection
            print(f"Successfully reconnected {quality} stream")
            self.last_reconnect_time = 0  # Reset backoff on success
        except Exception as e:
            print(f"Reconnection failed for {quality}: {str(e)}")
            await self.handle_stream_error(e, quality)

    async def stopStreaming(self):
        """Stop all streaming connections"""
        if self.is_streaming:
            print(f"Stopping video stream for {self.name}")
            
            # Close all connections in pool
            for quality, connection in self.connection_pool.items():
                if connection.get('process'):
                    connection['process'].terminate()
                
                if connection.get('streamUrl'):
                    stream_file = connection['streamUrl'].replace('file://', '')
                    if os.path.exists(stream_file):
                        os.unlink(stream_file)
            
            self.connection_pool.clear()
            self.active_connections = 0
            self.is_streaming = False
            self.last_reconnect_time = 0

    async def takePicture(self, options: Optional[Dict[str, Any]] = None) -> Any:
        """Take snapshot"""
        logging.info(f"📸 Taking snapshot from {self.name}")
        raise NotImplementedError("Snapshot requires P2P stream")

    async def take_tutk_snapshot(self) -> bytes:
        """Take snapshot using TUTK"""
        if not self.tutk_credentials:
            raise Exception('TUTK credentials not available')

        tutkid = self.tutk_credentials['tutkid']
        password = self.tutk_credentials['password']
        auth_key = self.tutk_credentials['authKey']
        
        # Create a temporary file for the snapshot
        temp_dir = tempfile.gettempdir()
        snapshot_file = os.path.join(temp_dir, f'owlet_{self.device_data.get("deviceId")}_snapshot.jpg')
        
        # Clean up any existing snapshot file
        if os.path.exists(snapshot_file):
            os.unlink(snapshot_file)

        # TUTK snapshot arguments
        tutk_args = [
            '--uid', tutkid,
            '--password', password,
            '--authkey', auth_key,
            '--snapshot', snapshot_file,
            '--format', 'jpeg',
            '--quality', '90'
        ]

        print(f"Taking TUTK snapshot for {tutkid}")
        
        # Spawn TUTK snapshot process
        snapshot_process = subprocess.Popen(
            ['tutk-snapshot'] + tutk_args,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )

        # Wait for snapshot to complete
        try:
            stdout, stderr = snapshot_process.communicate(timeout=30)
            
            if snapshot_process.returncode != 0:
                raise Exception(f"TUTK snapshot failed with code {snapshot_process.returncode}: {stderr.decode()}")
            
            # Read the snapshot file
            if not os.path.exists(snapshot_file):
                raise Exception('Snapshot file was not created')

            with open(snapshot_file, 'rb') as f:
                snapshot_data = f.read()
            
            # Clean up snapshot file
            os.unlink(snapshot_file)
            
            return snapshot_data
            
        except subprocess.TimeoutExpired:
            snapshot_process.kill()
            raise Exception('TUTK snapshot timeout')

    # Camera interface methods
    async def getPictureOptions(self) -> list:
        """Get picture options (empty for now)"""
        return []

    # VideoCamera interface methods
    async def getVideoStreamOptions(self) -> list:
        """Get video stream options (empty for now)"""
        return []

    # Device status methods
    async def getDeviceStatus(self) -> Dict[str, Any]:
        """Get device status"""
        return {
            'deviceId': self.device_data.get('deviceId'),
            'name': self.name,
            'status': self.device_data.get('status', 'unknown'),
            'isStreaming': self.is_streaming,
            'lastSeen': time.time()
        }

    # Settings interface methods
    async def getSettings(self) -> list:
        """Get camera settings"""
        return [
            {
                'key': 'deviceId',
                'title': 'Device ID',
                'description': 'Owlet device identifier',
                'type': 'string',
                'value': self.device_data.get('deviceId', ''),
                'readonly': True
            },
            {
                'key': 'status',
                'title': 'Status',
                'description': 'Current device status',
                'type': 'string',
                'value': self.device_data.get('status', 'unknown'),
                'readonly': True
            },
            {
                'key': 'serialNumber',
                'title': 'Serial Number',
                'description': 'Device serial number',
                'type': 'string',
                'value': self.device_data.get('serialNumber', ''),
                'readonly': True
            },
            {
                'key': 'firmwareVersion',
                'title': 'Firmware Version',
                'description': 'Device firmware version',
                'type': 'string',
                'value': self.device_data.get('firmwareVersion', ''),
                'readonly': True
            },
            {
                'key': 'tutkid',
                'title': 'TUTK ID',
                'description': 'TUTK device identifier',
                'type': 'string',
                'value': self.tutk_credentials.get('tutkid', '') if self.tutk_credentials else '',
                'readonly': True
            },
            {
                'key': 'streamQuality',
                'title': 'Default Stream Quality',
                'description': 'Default quality for video streams',
                'type': 'string',
                'value': self.current_quality,
                'choices': ['LD', 'SD', 'HD', '2K']
            },
            {
                'key': 'motionDetection',
                'title': 'Motion Detection',
                'description': 'Enable motion detection notifications',
                'type': 'boolean',
                'value': self.motion_detection
            },
            {
                'key': 'streamTimeout',
                'title': 'Stream Timeout (seconds)',
                'description': 'How long to keep streams active before timeout',
                'type': 'number',
                'value': self.stream_timeout,
                'range': [60, 1800]  # 1 minute to 30 minutes
            },
            {
                'key': 'maxConnections',
                'title': 'Max Concurrent Connections',
                'description': 'Maximum number of concurrent streams',
                'type': 'number',
                'value': self.max_connections,
                'range': [1, 5]
            },
            {
                'key': 'isStreaming',
                'title': 'Streaming Status',
                'description': 'Current streaming status',
                'type': 'boolean',
                'value': self.is_streaming,
                'readonly': True
            },
            {
                'key': 'activeConnections',
                'title': 'Active Connections',
                'description': 'Number of active stream connections',
                'type': 'number',
                'value': self.active_connections,
                'readonly': True
            }
        ]

    async def putSetting(self, key: str, value: Any):
        """Update camera settings"""
        if key == 'streamQuality':
            if isinstance(value, str) and value in ['LD', 'SD', 'HD', '2K']:
                self.current_quality = value
                print(f"Stream quality set to {value}")
        elif key == 'motionDetection':
            if isinstance(value, bool):
                self.motion_detection = value
                print(f"Motion detection {'enabled' if value else 'disabled'}")
        elif key == 'streamTimeout':
            if isinstance(value, (int, float)) and 60 <= value <= 1800:
                self.stream_timeout = int(value)
                print(f"Stream timeout set to {value} seconds")
        elif key == 'maxConnections':
            if isinstance(value, (int, float)) and 1 <= value <= 5:
                self.max_connections = int(value)
                print(f"Max connections set to {value}")
        else:
            print(f"Setting {key} = {value} (read-only for camera devices)")

    # Python TUTK wrapper methods
    async def get_python_tutk_stream(self, options: Optional[Dict[str, Any]] = None) -> Optional[Any]:
        """Get video stream using Python TUTK wrapper"""
        try:
            if not self.tutk_credentials:
                return None

            tutkid = self.tutk_credentials['tutkid']
            password = self.tutk_credentials['password']
            auth_key = self.tutk_credentials['authKey']
            duration = 30  # Default duration for Python stream
            
            print('Attempting Python TUTK stream...')
            
            result = await self.execute_python_tutk([
                '--id', tutkid,
                '--username', password,
                '--password', password,
                '--auth-key', auth_key,
                '--duration', str(duration)
            ])

            if result.get('success') and result.get('video_data'):
                # Decode base64 video data
                import base64
                video_data = base64.b64decode(result['video_data'])
                
                # Create temporary file for video stream
                temp_dir = tempfile.gettempdir()
                stream_file = os.path.join(temp_dir, f'owlet_python_{self.device_data.get("deviceId")}_stream.mp4')
                
                # Write video data to file
                with open(stream_file, 'wb') as f:
                    f.write(video_data)
                
                print(f"Python TUTK stream created: {stream_file}")
                
                return self.createMediaObject(f'file://{stream_file}', scrypted_sdk.ScryptedMimeTypes.FFmpegInput)
            
            return None
            
        except Exception as e:
            print(f'Python TUTK stream failed: {str(e)}')
            return None

    async def get_python_tutk_snapshot(self) -> Optional[bytes]:
        """Get snapshot using Python TUTK wrapper"""
        try:
            if not self.tutk_credentials:
                return None

            tutkid = self.tutk_credentials['tutkid']
            password = self.tutk_credentials['password']
            auth_key = self.tutk_credentials['authKey']
            
            print('Attempting Python TUTK snapshot...')
            
            result = await self.execute_python_tutk([
                '--id', tutkid,
                '--username', password,
                '--password', password,
                '--auth-key', auth_key,
                '--snapshot'
            ])

            if result.get('success') and result.get('image_data'):
                # Decode base64 image data
                import base64
                image_data = base64.b64decode(result['image_data'])
                print(f"Python TUTK snapshot captured: {len(image_data)} bytes")
                return image_data
            
            return None
            
        except Exception as e:
            print(f'Python TUTK snapshot failed: {str(e)}')
            return None

    async def execute_python_tutk(self, args: list) -> Dict[str, Any]:
        """Execute Python TUTK script"""
        try:
            python_script = os.path.join(os.path.dirname(__file__), '..', 'python', 'tutk-stream.py')
            process = subprocess.Popen(
                ['python3', python_script] + args,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True
            )
            
            stdout, stderr = process.communicate(timeout=60)
            
            if process.returncode == 0:
                try:
                    result = json.loads(stdout)
                    return result
                except json.JSONDecodeError:
                    raise Exception(f"Failed to parse Python output: {stdout}")
            else:
                raise Exception(f"Python script exited with code {process.returncode}: {stderr}")
                
        except subprocess.TimeoutExpired:
            process.kill()
            raise Exception("Python script timeout")
        except Exception as e:
            raise Exception(f"Failed to start Python script: {str(e)}")

    # Cleanup method for device removal
    async def cleanup(self):
        """Clean up camera resources"""
        print(f"Cleaning up camera {self.name}")
        await self.stopStreaming()
        await self.proxy.stop()

    # Destructor to ensure proper cleanup
    async def destroy(self):
        """Destroy camera instance"""
        print(f"Destroying camera {self.name}")
        await self.cleanup()
