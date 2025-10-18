# Scrypted Owlet Camera Plugin

[![npm version](https://img.shields.io/npm/v/scrypted-owlet-camera.svg)](https://www.npmjs.com/package/scrypted-owlet-camera)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A comprehensive Scrypted plugin for integrating Owlet baby monitor cameras with HomeKit, providing seamless access to your Owlet cameras through Apple's Home app.

## Features

- **🔍 Device Discovery**: Automatically discovers and manages Owlet cameras on your account
- **🏠 HomeKit Integration**: Exposes cameras to HomeKit for use in the Home app and Siri
- **📹 P2P Streaming**: Uses TUTK/IOTC technology for direct camera-to-device streaming
- **🎥 Multiple Stream Qualities**: Support for LD (480p), SD (720p), HD (1080p), and 2K (1440p)
- **🔗 Connection Pooling**: Efficient connection management for multiple concurrent streams
- **🔄 Error Recovery**: Automatic reconnection with exponential backoff
- **🔐 Secure Authentication**: Firebase-based authentication with Owlet API
- **⚡ Real-time Updates**: Periodic device refresh and status monitoring
- **📸 Snapshot Support**: Capture individual frames as JPEG images
- **⚙️ Configurable Settings**: Customizable stream quality, timeouts, and connection limits

## Installation

### Prerequisites

- **Scrypted Server**: Running Scrypted installation
- **Owlet Account**: Active Owlet account with camera access
- **Node.js**: Version 16+ (if building from source)
- **Network**: Stable internet connection for camera streaming

### Install via Scrypted UI

1. Open your Scrypted web interface
2. Navigate to **Plugins** → **Add Plugin**
3. Search for `scrypted-owlet-camera`
4. Click **Install** and wait for installation to complete
5. The plugin will appear in your plugins list

### Manual Installation

```bash
# Clone the repository
git clone https://github.com/frankea/scrypted-owlet-camera.git
cd scrypted-owlet-camera

# Install dependencies
npm install

# Build the plugin
npm run build

# Install in Scrypted
scrypted install .
```

### Local Development

For developers who want to test and modify the plugin locally:

```bash
# Clone the repository
git clone https://github.com/frankea/scrypted-owlet-camera.git
cd scrypted-owlet-camera

# Install dependencies
npm install

# Start development mode (hot reloading)
npm run dev

# Deploy to local Scrypted server
npm run scrypted-deploy-debug 127.0.0.1
```

See [DEVELOPMENT.md](DEVELOPMENT.md) for detailed local development instructions.

## Configuration

### Required Settings

After installation, configure the plugin with your Owlet account credentials:

1. **Owlet Email**: Your Owlet account email address
2. **Owlet Password**: Your Owlet account password
3. **Device Refresh Interval**: How often to refresh the device list (1-60 minutes, default: 5)

### Camera Settings

Each discovered camera offers additional configuration options:

- **Default Stream Quality**: Choose between LD, SD, HD, or 2K
- **Motion Detection**: Enable/disable motion detection notifications
- **Stream Timeout**: Configure stream timeout (60-1800 seconds)
- **Max Concurrent Connections**: Set maximum simultaneous streams (1-5)

### Configuration Steps

1. Open Scrypted web interface
2. Go to **Plugins** → **Owlet Camera**
3. Enter your Owlet credentials in the settings
4. Set your preferred refresh interval
5. Save settings and restart the plugin
6. Verify cameras appear in the device list

## Requirements

### System Requirements

- **Scrypted**: Version 0.2.0 or higher
- **Node.js**: Version 16.0.0 or higher
- **Operating System**: macOS 11+, iOS 14+, or compatible Linux/Windows
- **Network**: Stable internet connection with HTTPS access

### Owlet Account Requirements

- **Active Account**: Valid Owlet account with camera access
- **Camera Registration**: Cameras must be registered to your account
- **API Access**: Account must have API access enabled
- **Network Connectivity**: Cameras must be online and accessible

### Scrypted Installation

- **Scrypted Server**: Running Scrypted installation
- **Plugin Support**: Scrypted must support custom plugins
- **HomeKit Bridge**: HomeKit bridge must be enabled in Scrypted
- **Network Access**: Scrypted must have network access to Owlet servers

## Known Limitations

### Current Limitations

⚠️ **TUTK Streaming**: The plugin currently uses placeholder TUTK client scripts instead of the actual TUTK SDK. This means:
- Video streaming may not work reliably
- Snapshot functionality is limited
- Audio streaming is not supported
- Motion detection is not connected to actual camera events

### Technical Limitations

- **Snapshot Quality**: Limited to placeholder JPEG images
- **Audio Support**: Audio codec support depends on TUTK implementation
- **Night Vision**: Depends on camera hardware and TUTK support
- **Recording**: Local recording capabilities not yet implemented
- **Multiple Cameras**: Limited testing with multiple simultaneous cameras

### Planned Improvements

- **Real TUTK Integration**: Replace placeholder scripts with actual TUTK SDK
- **Enhanced Error Recovery**: Improve reconnection logic for network interruptions
- **Motion Detection**: Implement actual motion detection from camera feeds
- **Audio Support**: Add proper audio streaming support
- **Recording**: Add local recording capabilities
- **Night Vision**: Implement night vision mode support

## Troubleshooting

### Common Issues

#### Authentication Problems

**Problem**: "Invalid email address" or "Invalid password"
- **Solution**: Verify your Owlet account credentials
- **Check**: Ensure you're using the same email/password as your Owlet app
- **Test**: Try logging into the Owlet app with the same credentials

**Problem**: "Too many failed login attempts"
- **Solution**: Wait 15-30 minutes before trying again
- **Prevention**: Avoid rapid credential changes
- **Check**: Verify account status in Owlet app

**Problem**: "Account disabled"
- **Solution**: Contact Owlet support
- **Check**: Verify account status in Owlet app
- **Test**: Try accessing Owlet services directly

#### Network Issues

**Problem**: "Network error: Unable to connect to Owlet servers"
- **Solution**: Check internet connection
- **Check**: Verify firewall settings allow HTTPS traffic
- **Test**: Try accessing Owlet app on mobile device
- **Debug**: Check Scrypted logs for detailed error messages

**Problem**: "Connection timeout"
- **Solution**: Check network stability
- **Check**: Verify DNS resolution for Owlet domains
- **Test**: Try again during off-peak hours
- **Debug**: Monitor network connectivity during streaming

#### Camera Issues

**Problem**: "Camera offline or not accessible"
- **Solution**: Check camera power and network connection
- **Check**: Verify camera appears in Owlet app
- **Test**: Power cycle the camera
- **Debug**: Check camera status in Owlet app

**Problem**: "TUTK credentials not available"
- **Solution**: Wait a few moments and try again
- **Check**: Verify camera is online in Owlet app
- **Test**: Restart the Scrypted plugin
- **Debug**: Check plugin logs for credential errors

#### Streaming Issues

**Problem**: "Stream timeout" or "Connection lost"
- **Solution**: Check network stability
- **Check**: Verify camera has good WiFi signal
- **Test**: Try lower quality stream (LD or SD)
- **Debug**: Monitor stream quality and connection status

**Problem**: "Max concurrent connections reached"
- **Solution**: Close other active streams
- **Check**: Reduce max connections setting
- **Test**: Wait for inactive connections to timeout
- **Debug**: Check connection pool status

### Debugging Steps

#### Enable Debug Logging

1. Open Scrypted web interface
2. Go to **Settings** → **Logs**
3. Set log level to **Debug**
4. Check plugin logs for detailed information
5. Monitor logs during problematic operations

#### Common Log Messages

- `Starting device discovery...` - Plugin is searching for cameras
- `Successfully authenticated with Owlet API` - Authentication successful
- `Discovered X Owlet devices` - Found cameras on account
- `TUTK client error` - Streaming connection issue
- `Authentication expired` - Token needs refresh
- `Camera offline` - Camera is not accessible
- `Stream timeout` - Connection lost during streaming

#### Network Diagnostics

1. **Test Internet Connection**: Verify basic internet connectivity
2. **Check DNS Resolution**: Test resolution of Owlet domains
3. **Firewall Settings**: Ensure HTTPS traffic is allowed
4. **Port Access**: Verify required ports are accessible
5. **VPN Issues**: Check if VPN is interfering with connections

#### Camera Diagnostics

1. **Power Status**: Verify camera is powered on
2. **Network Connection**: Check camera's WiFi connection
3. **Owlet App**: Test camera access through official app
4. **Camera Status**: Verify camera appears online in Owlet app
5. **Signal Strength**: Check camera's WiFi signal strength

## Contributing

We welcome contributions to improve the Scrypted Owlet Camera Plugin! Here's how you can help:

### How to Contribute

1. **Fork the Repository**: Create your own fork of the project
2. **Create a Feature Branch**: Use a descriptive branch name
3. **Make Your Changes**: Implement your improvements
4. **Test Thoroughly**: Ensure your changes work correctly
5. **Submit a Pull Request**: Provide a clear description of your changes

### Development Setup

```bash
# Clone your fork
git clone https://github.com/yourusername/scrypted-owlet-camera.git
cd scrypted-owlet-camera

# Install dependencies
npm install

# Build the plugin
npm run build

# Watch for changes during development
npm run watch

# Run tests (when available)
npm test
```

### Code Guidelines

- **TypeScript**: Use TypeScript for all new code
- **ESLint**: Follow the project's ESLint configuration
- **Comments**: Add clear comments for complex logic
- **Error Handling**: Implement proper error handling
- **Logging**: Use appropriate logging levels
- **Testing**: Add tests for new functionality

### Areas for Contribution

- **TUTK Integration**: Help implement real TUTK SDK integration
- **Error Recovery**: Improve reconnection logic
- **Motion Detection**: Implement actual motion detection
- **Audio Support**: Add audio streaming capabilities
- **Documentation**: Improve documentation and examples
- **Testing**: Add comprehensive test coverage
- **Performance**: Optimize streaming performance
- **UI Improvements**: Enhance configuration interface

### Reporting Issues

When reporting issues, please include:

1. **Scrypted Version**: Version of Scrypted server
2. **Plugin Version**: Version of the Owlet plugin
3. **Error Messages**: Complete error messages from logs
4. **Steps to Reproduce**: Detailed steps to reproduce the issue
5. **System Information**: OS, Node.js version, network setup
6. **Camera Information**: Owlet camera model and firmware version
7. **Network Environment**: Network setup and configuration

### Pull Request Guidelines

- **Clear Description**: Provide a clear description of changes
- **Testing**: Include testing information
- **Documentation**: Update documentation if needed
- **Backward Compatibility**: Ensure changes don't break existing functionality
- **Code Quality**: Follow project coding standards
- **Commit Messages**: Use clear, descriptive commit messages

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

### MIT License Summary

- **Commercial Use**: ✅ Allowed
- **Modification**: ✅ Allowed
- **Distribution**: ✅ Allowed
- **Private Use**: ✅ Allowed
- **Liability**: ❌ No liability
- **Warranty**: ❌ No warranty

### Third-Party Licenses

This plugin integrates with several third-party services:

- **Scrypted**: Licensed under their respective terms
- **Owlet API**: Subject to Owlet's terms of service
- **TUTK/IOTC**: Subject to TUTK's licensing terms
- **Firebase**: Subject to Google's terms of service

## Support

### Getting Help

- **GitHub Issues**: Report bugs and request features
- **GitHub Discussions**: Ask questions and share ideas
- **Documentation**: Check this README and inline code comments
- **Scrypted Community**: Join the Scrypted community forums
- **Owlet Support**: Contact Owlet for camera-specific issues

### Community Resources

- **Scrypted Documentation**: [Scrypted.dev](https://scrypted.dev)
- **HomeKit Documentation**: [Apple Developer](https://developer.apple.com/homekit/)
- **Owlet Support**: [Owlet Support](https://support.owletcare.com)
- **TUTK Documentation**: [TUTK Developer](https://www.tutk.com)

### Professional Support

For professional support or custom development:

- **Contact**: [afranke@gmail.com](mailto:afranke@gmail.com)
- **GitHub**: [@frankea](https://github.com/frankea)
- **Issues**: [GitHub Issues](https://github.com/frankea/scrypted-owlet-camera/issues)

## Acknowledgments

- **Scrypted Team**: For the excellent plugin framework and support
- **Owlet**: For providing the camera hardware and API access
- **TUTK**: For the P2P streaming technology
- **Firebase**: For authentication services
- **Community**: For feedback, contributions, and testing
- **Contributors**: All those who have contributed to this project

## Changelog

### Version 1.0.0
- Initial release
- Basic device discovery
- HomeKit integration
- Placeholder TUTK streaming
- Authentication system
- Configuration interface

### Roadmap
- Real TUTK SDK integration
- Enhanced error recovery
- Motion detection implementation
- Audio streaming support
- Local recording capabilities
- Night vision support
- Performance optimizations

---

**Note**: This plugin is not officially affiliated with Owlet or Scrypted. Use at your own risk and ensure compliance with all applicable terms of service.