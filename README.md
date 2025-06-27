# Billa - Discord Bot

A Discord bot built with TypeScript and Discord.js that integrates with Google APIs.

## Features

- Discord bot functionality
- Google API integration
- TypeScript support

## Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- Discord Bot Token
- Google Service Account credentials

## Installation

1. Clone the repository:
```bash
git clone <your-repo-url>
cd Billa
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
   - Create a `.env` file in the root directory
   - Add your Discord bot token and other sensitive information

4. Set up Google Service Account:
   - Place your Google service account JSON file in the project root
   - The file should be named according to your configuration
   - **IMPORTANT**: Never commit this file to version control

## Environment Variables

Create a `.env` file with the following variables:

```env
DISCORD_TOKEN=your_discord_bot_token_here
GOOGLE_SERVICE_ACCOUNT_PATH=path_to_your_service_account.json
```

## Running the Bot

```bash
npm start
```

## Security Notes

⚠️ **IMPORTANT**: This project contains sensitive credentials that should never be committed to version control:

- Google service account JSON files (contain private keys)
- Discord bot tokens
- Any `.env` files

The `.gitignore` file is configured to exclude these sensitive files.

## Development

- Built with TypeScript
- Uses Discord.js for Discord API integration
- Integrates with Google APIs for additional functionality

## License

ISC 