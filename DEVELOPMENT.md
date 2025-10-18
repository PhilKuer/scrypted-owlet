# Local Development Guide

This guide explains how to develop and test the Scrypted Owlet Camera plugin locally on your Mac Studio without publishing to npm.

## Prerequisites

### Required Software
- **Node.js**: Version 16+ (check with `node --version`)
- **npm**: Version 8+ (check with `npm --version`)
- **Scrypted Server**: Running locally or on network
- **VS Code**: For debugging (optional but recommended)

### Scrypted Server Setup
1. Install Scrypted on your Mac Studio
2. Ensure Scrypted is running and accessible
3. Note the Scrypted server IP address (usually `127.0.0.1` for local)

## Development Workflow

### 1. Initial Setup

```bash
# Clone the repository
git clone https://github.com/frankea/scrypted-owlet-camera.git
cd scrypted-owlet-camera

# Install dependencies
npm install

# Build the plugin
npm run build
```

### 2. Development Mode (Hot Reloading)

For active development with automatic rebuilding:

```bash
# Start watch mode - rebuilds on file changes
npm run dev
# or
npm run scrypted-watch
```

This will:
- Watch for TypeScript file changes
- Automatically rebuild using `scrypted-webpack --watch`
- Output to `out/` directory
- Enable hot reloading in Scrypted

### 3. Deploy for Testing

Deploy the plugin to your Scrypted server for testing:

```bash
# Deploy to Scrypted (replace with your Scrypted server IP)
npm run scrypted-deploy-debug 127.0.0.1
```

This will:
- Build the plugin
- Deploy to Scrypted server
- Enable debugging mode
- Make the plugin available in Scrypted UI

### 4. VS Code Debugging

For debugging with breakpoints:

1. **Open VS Code** in the project directory
2. **Set breakpoints** in your TypeScript files
3. **Press F5** or use "Scrypted Debugger" configuration
4. **VS Code will**:
   - Build the plugin
   - Deploy to Scrypted
   - Attach debugger on port 10081
   - Enable source map debugging

#### Debug Configuration
- **Port**: 10081 (Scrypted debug port)
- **Host**: 127.0.0.1 (configurable in `.vscode/settings.json`)
- **Source Maps**: Enabled for TypeScript debugging
- **Pre-launch Task**: Automatically deploys plugin

### 5. Testing the Plugin

After deployment:

1. **Open Scrypted UI** in your browser
2. **Go to Plugins** → **Installed Plugins**
3. **Find "Owlet Camera"** plugin
4. **Configure settings**:
   - Enter your Owlet email
   - Enter your Owlet password
   - Set refresh interval
5. **Save settings** and restart plugin
6. **Check device discovery** in Scrypted
7. **Test HomeKit integration** in Apple Home app

## Available Scripts

### Development Scripts
```bash
npm run dev              # Start development mode (watch + rebuild)
npm run scrypted-watch   # Watch mode with scrypted-webpack
npm run build            # Build plugin once
npm run watch            # TypeScript watch mode (legacy)
```

### Deployment Scripts
```bash
npm run scrypted-deploy-debug  # Deploy with debugging enabled
npm run scrypted-deploy        # Deploy to Scrypted server
npm run scrypted-debug         # Start debug mode
```

### Utility Scripts
```bash
npm run scrypted-setup-project # Initialize Scrypted project
npm run scrypted-readme        # Generate README from package.json
npm run scrypted-package-json  # Update package.json metadata
```

## Development Tips

### Hot Reloading
- Changes to TypeScript files automatically trigger rebuilds
- Plugin updates in Scrypted without manual restart
- Use `npm run dev` for continuous development

### Debugging
- Set breakpoints in VS Code before starting debugger
- Use `console.log()` for quick debugging
- Check Scrypted logs for plugin output
- Monitor network requests in browser dev tools

### Testing Workflow
1. **Make changes** to TypeScript files
2. **Save files** (triggers automatic rebuild)
3. **Test in Scrypted** (plugin updates automatically)
4. **Debug issues** using VS Code or console logs
5. **Iterate** until working correctly

### Common Issues

#### Plugin Not Appearing
- Check Scrypted server is running
- Verify deployment completed successfully
- Check Scrypted logs for errors
- Ensure plugin is enabled in Scrypted UI

#### Debugger Not Connecting
- Verify Scrypted server IP address
- Check port 10081 is not blocked
- Ensure plugin is deployed in debug mode
- Check VS Code debug configuration

#### Build Errors
- Check TypeScript syntax errors
- Verify all imports are correct
- Ensure dependencies are installed
- Check `out/` directory permissions

## File Structure

```
scrypted-owlet-camera/
├── src/                    # TypeScript source files
│   ├── main.ts            # Main plugin entry point
│   ├── owlet-auth.ts      # Authentication logic
│   └── owlet-camera.ts    # Camera device implementation
├── out/                   # Built plugin output
├── .vscode/               # VS Code configuration
│   ├── launch.json        # Debug configuration
│   ├── settings.json      # Debug settings
│   └── tasks.json         # Build tasks
├── package.json           # Plugin metadata and scripts
├── tsconfig.json          # TypeScript configuration
└── README.md              # Plugin documentation
```

## Scrypted Integration

### Plugin Configuration
The plugin is configured in `package.json` under the `scrypted` key:

```json
{
  "scrypted": {
    "rollup": true,
    "name": "Owlet Camera",
    "type": "DeviceProvider",
    "interfaces": ["DeviceProvider", "Settings"]
  }
}
```

### Settings Schema
Plugin settings are defined in `package.json`:

- **email**: Owlet account email
- **password**: Owlet account password  
- **refreshInterval**: Device refresh interval (1-60 minutes)

### Device Discovery
The plugin implements `DeviceProvider` interface to:
- Discover Owlet cameras on the account
- Create camera devices in Scrypted
- Expose cameras to HomeKit

## Troubleshooting

### Development Issues

#### Build Failures
```bash
# Clean build
rm -rf out/
npm run build

# Check TypeScript errors
npx tsc --noEmit
```

#### Deployment Issues
```bash
# Check Scrypted server status
curl http://127.0.0.1:10443/api/status

# Verify plugin deployment
npm run scrypted-deploy-debug 127.0.0.1
```

#### Debugging Issues
```bash
# Check debug port
netstat -an | grep 10081

# Restart Scrypted server
# Check VS Code debug configuration
```

### Plugin Issues

#### Authentication Errors
- Verify Owlet credentials
- Check network connectivity
- Review authentication logs

#### Camera Discovery Issues
- Ensure cameras are online
- Check Owlet app connectivity
- Verify account permissions

#### HomeKit Integration Issues
- Check Scrypted HomeKit bridge
- Verify camera exposure settings
- Test HomeKit pairing

## Next Steps

1. **Test locally** using the development workflow
2. **Debug issues** using VS Code or console logs
3. **Iterate quickly** with hot reloading
4. **Deploy to production** when ready
5. **Publish to npm** for distribution

## Support

For development issues:
- Check Scrypted documentation: https://scrypted.dev
- Review plugin logs in Scrypted UI
- Check GitHub issues: https://github.com/frankea/scrypted-owlet-camera/issues
- Join Scrypted community forums

---

**Happy coding!** 🚀
