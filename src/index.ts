// src/index.ts
import {
    Client,
    GatewayIntentBits,
    Message, 
    TextChannel,
    DMChannel,
    REST,
    Routes,
    ChatInputCommandInteraction,
    SlashCommandBuilder,
    PermissionFlagsBits,
    Attachment,
    ActivityType, 
    Partials 
} from 'discord.js';
import dotenv from 'dotenv';
import { GoogleGenerativeAI, GenerativeModel, Part, SchemaType } from '@google/generative-ai';
import { google } from 'googleapis';
import { ExpenseRecord, ParsedManualExpense, ParsedImageExpense, Category } from './types';
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';

dotenv.config();

// --- Configuration ---
const SERVICE_ACCOUNT_FILE = 'fin-track-discord-bot-1836ac2f6820.json';
const SPREADSHEET_URL = 'https://docs.google.com/spreadsheets/d/1Ru4Fipfk3KlTMK_1SnkhjJtR6oe35rVn0lJEhTJbLWQ/edit?gid=0#gid=0';
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID!;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN!;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const GUILD_ID = process.env.GUILD_ID!;

// --- Global Variables ---
let sheets: ReturnType<typeof google.sheets>;

const categories: Category[] = [
    { name: 'Food', value: 'food' },
    { name: 'Groceries', value: 'groceries' },
    { name: 'Transport', value: 'transport' },
    { name: 'Clothes', value: 'clothes' },
    { name: 'Entertainment', value: 'entertainment' },
    { name: 'Healthcare', value: 'healthcare' },
    { name: 'Utilities', value: 'utilities' },
    { name: 'Shopping', value: 'shopping' },
    { name: 'Education', value: 'education' },
    { name: 'Other', value: 'other' }
];

// --- Google Sheets Setup ---
async function setupGoogleSheets() {
    try {
        const auth = new google.auth.GoogleAuth({
            keyFile: SERVICE_ACCOUNT_FILE,
            scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
        });
        const authClient = await auth.getClient();
        sheets = google.sheets({ version: 'v4', auth: authClient as any });
        console.log('Google Sheets authenticated and ready.');
    } catch (error) {
        console.error('Error setting up Google Sheets:', error);
        process.exit(1);
    }
}

// --- Gemini API Setup ---
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const geminiFlashModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

// --- Discord Client Setup ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction], // <-- FIX: Partials is now correctly imported
});

// --- Slash Command Definitions ---
const commands = [
    new SlashCommandBuilder()
        .setName('expense')
        .setDescription('Manage your expenses.')
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Manually add a new expense.')
                .addStringOption(option =>
                    option.setName('details')
                        .setDescription('Details of the expense (e.g., "lunch at cafe for 200 today").')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('upload')
                .setDescription('Upload a bill image to add an expense.')
                .addAttachmentOption(option =>
                    option.setName('bill_image')
                        .setDescription('The image of the bill/receipt.')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('summary')
                .setDescription('Get a summary of expenses.')
                .addStringOption(option =>
                    option.setName('timeframe')
                        .setDescription('Select the timeframe for the summary.')
                        .setRequired(true)
                        .addChoices(
                            { name: 'This Month', value: 'this_month' },
                            { name: 'Last Month', value: 'last_month' },
                            { name: 'This Year', value: 'this_year' },
                            { name: 'Last Year', value: 'last_year' },
                            { name: 'All Time', value: 'all_time' }
                        )
                )
        ),
    new SlashCommandBuilder()
        .setName('category')
        .setDescription('Manage expense categories.')
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add a new expense category.')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('The name of the new category (e.g., "Subscriptions").')
                        .setRequired(true)
                )
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
];

// --- Register Slash Commands ---
const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN);

(async () => {
    try {
        console.log('Started refreshing application (/) commands.');

        await rest.put(
            Routes.applicationGuildCommands(DISCORD_CLIENT_ID, GUILD_ID),
            { body: commands },
        );

        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
})();

// --- Helper Functions ---
function getSpreadsheetId(url: string): string | null {
    const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
}

function getCategoryPromptString(): string {
    return categories.map(cat => `'${cat.name}'`).join(', ');
}

// --- Bot Ready Event ---
client.once('ready', async () => {
    console.log(`We have logged in as ${client.user?.tag}`);
    await setupGoogleSheets();
    client.user?.setActivity('your expenses with /expense', { type: ActivityType.Watching });
});

// --- Handle Slash Commands ---
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction; // <-- FIX: Removed subcommand from destructuring
    const subcommand = interaction.options.getSubcommand(); // <-- FIX: Get subcommand using this method

    // Type guard for interaction.channel.send
    if (!(interaction.channel instanceof TextChannel || interaction.channel instanceof DMChannel)) {
        await interaction.reply({ content: 'I can only respond in text channels or DMs.', ephemeral: true });
        return;
    }

    const current_date = new Date().toISOString().split('T')[0];

    if (commandName === 'expense') {
        if (subcommand === 'add') {
            await interaction.deferReply();

            const details = interaction.options.getString('details', true);

            const prompt_template = `
Extract the following information from the input sentence and return it as a JSON object in this format:
{
  "amount": <amount spent as a number>,
  "merchant": <name of the merchant/place where money was spent>,
  "purpose": <brief description of the spending purpose>,
  "category": <best fitting category from [${getCategoryPromptString()}]>,
  "spend_date": <date in YYYY-MM-DD format>
}

Instructions:
- Extract the amount as a number.
- Extract the merchant/place name.
- Extract the spending purpose/description.
- For "category", choose the BEST fit from the provided list. If no clear category matches, use 'Other'.
- For "spend_date", convert time references like "today", "yesterday", "two days ago", "last Monday", etc. to an actual date in YYYY-MM-DD format based on the current date of ${current_date}.

Input sentence:
${details}

Return ONLY the JSON object.
`;

            try {
                const result = await geminiFlashModel.generateContent({
                    contents: [{ role: 'user', parts: [{ text: prompt_template }] }],
                    generationConfig: {
                        responseMimeType: 'application/json',
                        responseSchema: {
                            type: SchemaType.OBJECT,
                            properties: {
                                amount: { type: SchemaType.NUMBER },
                                merchant: { type: SchemaType.STRING },
                                purpose: { type: SchemaType.STRING },
                                category: { type: SchemaType.STRING },
                                spend_date: { type: SchemaType.STRING },
                            },
                            required: ['amount', 'merchant', 'purpose', 'category', 'spend_date'],
                        },
                    },
                });

                const parsedResponse: ParsedManualExpense = JSON.parse(result.response.text());

                const inferredCategoryValue = parsedResponse.category.toLowerCase();
                const validCategory = categories.find(cat => cat.value === inferredCategoryValue || cat.name.toLowerCase() === inferredCategoryValue);
                const finalCategory = validCategory ? validCategory.name : 'Other';

                const expenseRecord: ExpenseRecord = {
                    date: parsedResponse.spend_date,
                    amount: parsedResponse.amount,
                    merchant: parsedResponse.merchant,
                    category: finalCategory,
                    description: parsedResponse.purpose,
                    entryMethod: 'Manual Entry'
                };

                const spreadsheetId = getSpreadsheetId(SPREADSHEET_URL);
                if (spreadsheetId && sheets) {
                    await sheets.spreadsheets.values.append({
                        spreadsheetId: spreadsheetId,
                        range: 'Sheet1!A:F',
                        valueInputOption: 'USER_ENTERED',
                        requestBody: {
                            values: [Object.values(expenseRecord)],
                        },
                    });
                    await interaction.editReply(`Expense added successfully!
\`\`\`
Date: ${expenseRecord.date}
Amount: ${expenseRecord.amount}
Merchant: ${expenseRecord.merchant}
Category: ${expenseRecord.category}
Description: ${expenseRecord.description}
Entry Method: ${expenseRecord.entryMethod}
\`\`\``);
                } else {
                    await interaction.editReply('Error: Google Sheets API not initialized or spreadsheet ID not found.');
                }

            } catch (error: any) {
                console.error('Error processing /expense add:', error);
                await interaction.editReply(`Failed to add expense. Error: ${error.message || 'Unknown error'}`);
            }
        } else if (subcommand === 'upload') {
            await interaction.deferReply();

            const billImageAttachment = interaction.options.getAttachment('bill_image', true);

            if (!billImageAttachment.contentType?.startsWith('image/')) {
                await interaction.editReply('Please upload an image file (PNG, JPG, JPEG).');
                return;
            }

            const image_url = billImageAttachment.url;
            const tempDir = path.join(__dirname, '..', 'temp_images');
            await fs.mkdir(tempDir, { recursive: true });
            const img_path = path.join(tempDir, `bill_${Date.now()}_${billImageAttachment.name}`);

            try {
                const response = await axios({
                    method: 'get',
                    url: image_url,
                    responseType: 'arraybuffer',
                });
                await fs.writeFile(img_path, response.data);

                const imgBytes = await fs.readFile(img_path);
                const mimeType = billImageAttachment.contentType;

                const prompt = `
Extract the following information from this bill image. If any field is missing or cannot be inferred, return null for that field.
Return only a JSON object in this format:
{
  "amount": <amount spent as a number or null>,
  "merchant": <name of the merchant/place or null>,
  "purpose": <brief description of the spending or null>,
  "category": <best fitting category from [${getCategoryPromptString()}] or null>,
  "spend_date": <date in YYYY-MM-DD format or null>
}
Here is the bill image:
`;
                const imagePart: Part = {
                    inlineData: {
                        data: Buffer.from(imgBytes).toString('base64'),
                        mimeType: mimeType,
                    },
                };

                const result = await geminiFlashModel.generateContent({
                    contents: [{ role: 'user', parts: [imagePart, { text: prompt }] }],
                    generationConfig: {
                        responseMimeType: 'application/json',
                        responseSchema: {
                            type: SchemaType.OBJECT,
                            properties: {
                                amount: { type: SchemaType.NUMBER, nullable: true },
                                merchant: { type: SchemaType.STRING, nullable: true },
                                purpose: { type: SchemaType.STRING, nullable: true },
                                category: { type: SchemaType.STRING, nullable: true },
                                spend_date: { type: SchemaType.STRING, nullable: true },
                            },
                        },
                    },
                });

                const parsedResponse: ParsedImageExpense = JSON.parse(result.response.text());

                const finalAmount = parsedResponse.amount ?? 0;
                const finalMerchant = parsedResponse.merchant ?? 'Unknown Merchant';
                const finalPurpose = parsedResponse.purpose ?? 'Unspecified';
                const finalSpend_date = parsedResponse.spend_date ?? current_date;

                let finalCategory = 'Other';
                if (parsedResponse.category) {
                    const inferredCategoryValue = parsedResponse.category.toLowerCase();
                    const validCategory = categories.find(cat => cat.value === inferredCategoryValue || cat.name.toLowerCase() === inferredCategoryValue);
                    finalCategory = validCategory ? validCategory.name : 'Other';
                }

                const expenseRecord: ExpenseRecord = {
                    date: finalSpend_date,
                    amount: finalAmount,
                    merchant: finalMerchant,
                    category: finalCategory,
                    description: finalPurpose,
                    entryMethod: 'Via Image/Pic'
                };

                const spreadsheetId = getSpreadsheetId(SPREADSHEET_URL);
                if (spreadsheetId && sheets) {
                    await sheets.spreadsheets.values.append({
                        spreadsheetId: spreadsheetId,
                        range: 'Sheet1!A:F',
                        valueInputOption: 'USER_ENTERED',
                        requestBody: {
                            values: [Object.values(expenseRecord)],
                        },
                    });
                    await interaction.editReply(`Expense from image added successfully!
\`\`\`
Date: ${expenseRecord.date}
Amount: ${expenseRecord.amount}
Merchant: ${expenseRecord.merchant}
Category: ${expenseRecord.category}
Description: ${expenseRecord.description}
Entry Method: ${expenseRecord.entryMethod}
\`\`\``);
                } else {
                    await interaction.editReply('Error: Google Sheets API not initialized or spreadsheet ID not found.');
                }

            } catch (error: any) {
                console.error('Error processing /expense upload:', error);
                await interaction.editReply(`Failed to add expense from image. Error: ${error.message || 'Unknown error'}`);
            } finally {
                try {
                    await fs.unlink(img_path);
                } catch (unlinkError) {
                    console.error('Error deleting local image:', unlinkError);
                }
            }
        } else if (subcommand === 'summary') {
            await interaction.deferReply();

            const timeframe = interaction.options.getString('timeframe', true);
            const spreadsheetId = getSpreadsheetId(SPREADSHEET_URL);

            if (!spreadsheetId || !sheets) {
                await interaction.editReply('Error: Google Sheets API not initialized or spreadsheet ID not found.');
                return;
            }

            try {
                const response = await sheets.spreadsheets.values.get({
                    spreadsheetId: spreadsheetId,
                    range: 'Sheet1!A:F',
                });

                const rows: string[][] = response.data.values || [];

                if (rows.length <= 1) {
                    await interaction.editReply('No expenses recorded yet!');
                    return;
                }

                const expenses: ExpenseRecord[] = rows.slice(1).map(row => ({
                    date: row[0],
                    amount: parseFloat(row[1]),
                    merchant: row[2],
                    category: row[3],
                    description: row[4],
                    entryMethod: row[5] as ExpenseRecord['entryMethod'],
                }));

                let filteredExpenses: ExpenseRecord[] = [];
                const now = new Date();
                const currentYear = now.getFullYear();
                const currentMonth = now.getMonth();

                switch (timeframe) {
                    case 'this_month':
                        filteredExpenses = expenses.filter(exp => {
                            const expDate = new Date(exp.date);
                            return expDate.getFullYear() === currentYear && expDate.getMonth() === currentMonth;
                        });
                        break;
                    case 'last_month':
                        const lastMonth = currentMonth === 0 ? 11 : currentMonth - 1;
                        const lastMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear;
                        filteredExpenses = expenses.filter(exp => {
                            const expDate = new Date(exp.date);
                            return expDate.getFullYear() === lastMonthYear && expDate.getMonth() === lastMonth;
                        });
                        break;
                    case 'this_year':
                        filteredExpenses = expenses.filter(exp => new Date(exp.date).getFullYear() === currentYear);
                        break;
                    case 'last_year':
                        filteredExpenses = expenses.filter(exp => new Date(exp.date).getFullYear() === currentYear - 1);
                        break;
                    case 'all_time':
                        filteredExpenses = expenses;
                        break;
                }

                if (filteredExpenses.length === 0) {
                    await interaction.editReply(`No expenses found for **${timeframe.replace('_', ' ')}**.`);
                    return;
                }

                const summary: { [category: string]: number } = {};
                let totalExpenditure = 0;

                for (const exp of filteredExpenses) {
                    const category = exp.category || 'Uncategorized';
                    if (!summary[category]) {
                        summary[category] = 0;
                    }
                    summary[category] += exp.amount;
                    totalExpenditure += exp.amount;
                }

                let summaryMessage = `**Expense Summary for ${timeframe.replace('_', ' ')}:**\n\n`;
                for (const cat of Object.keys(summary).sort()) {
                    summaryMessage += `- **${cat}**: ₹${summary[cat].toFixed(2)}\n`;
                }
                summaryMessage += `\n**Total Expenditure**: ₹${totalExpenditure.toFixed(2)}`;

                await interaction.editReply(summaryMessage);

            } catch (error: any) {
                console.error('Error processing /expense summary:', error);
                await interaction.editReply(`Failed to retrieve summary. Error: ${error.message || 'Unknown error'}`);
            }
        }
    } else if (commandName === 'category') {
        if (subcommand === 'add') {
            await interaction.deferReply({ ephemeral: true });

            const newCategoryName = interaction.options.getString('name', true);
            const newCategoryValue = newCategoryName.toLowerCase().replace(/\s/g, '');

            if (categories.some(cat => cat.value === newCategoryValue)) {
                await interaction.editReply(`Category '${newCategoryName}' already exists.`);
                return;
            }

            categories.push({ name: newCategoryName, value: newCategoryValue });

            await interaction.editReply(`Category '${newCategoryName}' added successfully! Current categories: ${categories.map(c => c.name).join(', ')}`);
        }
    }
});

client.login(DISCORD_BOT_TOKEN);