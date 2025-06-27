// src/types.ts

// Define the structure of an Expense record for the Google Sheet
export interface ExpenseRecord {
  date: string; // YYYY-MM-DD
  amount: number;
  merchant: string;
  category: string;
  description: string;
  entryMethod: 'Manual Entry' | 'Via Image/Pic';
}

// Define the structure for the parsed data from Gemini (for manual entry)
export interface ParsedManualExpense {
  amount: number;
  merchant: string; 
  purpose: string; 
  category: string; 
  spend_date: string; 
}

// Define the structure for the parsed data from Gemini (for image upload)
export interface ParsedImageExpense {
  amount: number | null;
  merchant: string | null; 
  purpose: string | null; 
  category: string | null; 
  spend_date: string | null;
}

// Define the structure for a Category
export interface Category {
  name: string;
  value: string; 
}