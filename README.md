# TubeBrow

A custom Electron browser application specifically designed for browsing YouTube channels without distractions.

## Features

- No address bar - focused browsing experience
- Load YouTube channels directly from settings
- Store VPN information for reference
- Simple, clean interface
- Settings saved between sessions

## Getting Started

### Prerequisites

- Node.js (v14 or higher)
- npm or pnpm

### Installation

1. Clone the repository:

   ```
   git clone https://github.com/your-username/tubebrow.git
   cd tubebrow
   ```

2. Install dependencies:

   ```
   npm install
   # or with pnpm
   pnpm install
   ```

3. Start the application:
   ```
   npm start
   # or with pnpm
   pnpm start
   ```

### Development

To run in development mode with DevTools enabled:

```
npm run dev
# or with pnpm
pnpm run dev
```

### Building the Application

To build the application for your platform:

```
npm run build
# or with pnpm
pnpm run build
```

This will create distributable packages in the `dist` directory.

## Usage

1. When you first launch the application, it will load the default YouTube page.
2. Click the ⚙️ (Settings) button in the top-right corner to open the settings.
3. Enter the URL of your favorite YouTube channel.
4. Optionally, add VPN information in the textarea.
5. Click "Save Settings" to apply changes.

The application will remember your settings for the next time you launch it.

## License

ISC
