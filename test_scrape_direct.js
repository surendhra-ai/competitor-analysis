import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI, Type } from '@google/genai';
import Database from 'better-sqlite3';
import dotenv from 'dotenv';

dotenv.config({ override: true });

const db = new Database('realintel.db');

function getSupabase() {
  const urlRow = db.prepare("SELECT value FROM settings WHERE key = 'supabaseUrl'").get();
  const keyRow = db.prepare("SELECT value FROM settings WHERE key = 'supabaseKey'").get();
  if (!urlRow || !keyRow || !urlRow.value || !keyRow.value) {
    throw new Error('Supabase URL and Key are not configured in Settings.');
  }
  return createClient(urlRow.value, keyRow.value);
}

const supabase = getSupabase();
const geminiApiKeyRow = db.prepare("SELECT value FROM settings WHERE key = 'geminiApiKey'").get();
let dbKey = geminiApiKeyRow ? geminiApiKeyRow.value : '';
if (dbKey && !dbKey.startsWith('AIzaSy')) {
  dbKey = '';
}
const geminiApiKey = dbKey || process.env.GEMINI_API_KEY;

async function run() {
  const { data: project } = await supabase.from('projects').select('*').eq('id', 'f2c74cb0-38f3-4b5c-af6f-4787e934ecb1').single();
  console.log('Project:', project.name);

  const searchAi = new GoogleGenAI({ apiKey: geminiApiKey });
  const searchPrompt = `
    You are an expert real estate data researcher. Your task is to find comprehensive and up-to-date details for the project "${project.name}" located in "${project.location || 'Telangana, India'}".
    ${project.rera_registration_number ? `The RERA Registration Number is ${project.rera_registration_number}.` : ''}
    
    Please use the Google Search tool to find the most accurate information from:
    1. Official RERA websites, specifically prioritizing these sites: https://rera.telangana.gov.in/. If a RERA number is provided, you MUST search for that exact number on the RERA site to find the official project details.
    2. The official project microsite (${project.official_url})
    3. Major property portals (MagicBricks, Housing.com, 99acres, SquareYards, PropTiger).
    4. Official social media pages (Facebook, Instagram, YouTube), broker videos, or recent news articles for the project.

    You MUST find and extract the following specific data points. If you don't find them in the first search, you must try different search queries (e.g., "${project.name} price per sqft", "${project.name} construction update 2025", "${project.name} possession date RERA", "${project.name} brochure pdf", "${project.rera_registration_number} RERA details").

    Data points to find:
    - Total Number of Units/Apartments
    - Number of Floors and Towers
    - Total Land Area in Acres
    - Base Price per Sq.Ft (₹/sft)
    - Landed Price per Sq.Ft (₹/sft) or total package price
    - Current Construction Stage
    - Expected Handover/Possession Date
    - Any active schemes, offers, or pre-launch benefits
    - Marketing focus or social media summary

    CRITICAL INSTRUCTION: Do NOT guess or hallucinate numbers. If you cannot find a specific value, explicitly state "Not found". Provide a highly detailed summary of your findings, explicitly mentioning the values for each of the data points above. If a value is an estimate or range, provide that. Do not just say "found on MagicBricks", actually provide the numbers and text.
  `;
  
  console.log('Running search grounding...');
  let searchSummary = '';
  try {
    const searchResponse = await searchAi.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: searchPrompt,
      config: {
        tools: [{ googleSearch: {} }]
      }
    });
    searchSummary = searchResponse.text || '';
    console.log('Search Summary:\n', searchSummary);
  } catch (searchError) {
    console.warn('Search grounding failed, continuing without it:', searchError.message || searchError);
  }

  const prompt = `
    You are an expert real estate data extraction system.
    Analyze the following scraped text from a real estate project website AND the supplemental web search summary.
    Project Name: ${project.name}
    
    Extract the following information. You MUST merge the data from both sources. If the official website text is vague or missing data, heavily rely on the Supplemental Web Search Summary (which contains RERA info, portal data, and social media updates).
    
    Supplemental Web Search Summary:
    ${searchSummary}
    
    CRITICAL: DO NOT GUESS OR HALLUCINATE VALUES. If a specific data point is not explicitly mentioned in either the scraped text or the search summary, you MUST return null for that field. Do not assume a default price like 8500 unless it is explicitly stated for this specific project.

    - Number of Units (integer, null if not found)
    - Number of Floors (integer, null if not found)
    - Land Area in Acres (number, null if not found)
    - Base Price per Sft in Rs (number, null if not found. Extract approximate numerical value only. This is the raw price before amenities/parking. e.g., if "starts at 8,500/sqft", extract 8500. If a range is given, take the lower bound. Do NOT confuse with total package price. If only a total package price is given and no per-sqft price is explicitly mentioned, you MUST return null.)
    - Landed Price per Sft in Rs (number, null if not found. Extract approximate numerical value only. This is the all-inclusive price. If only total package price is given (e.g., 1.5 Cr for 1500 sqft), calculate the landed price per sqft (15000000/1500 = 10000). If you cannot confidently calculate it because the exact area for that price is missing, you MUST return null. Do not guess or estimate.)
    - Construction Stage (short text, e.g., "Excavation", "Foundation", "Superstructure", "Finishing", null if not found)
    - Handover Date (text, e.g., "Dec 2025", null if not found. Look for "possession", "completion", "handover", or "RERA possession date". Ensure you extract the year and month if available. If multiple dates are found, prefer the RERA possession date or the latest completion date mentioned.)
    - Schemes/Offers (array of strings, empty if none)
    - Social/Ads Summary (short text summarizing any marketing campaigns, broker videos, or social proof mentioned, null if not found)

    Supplemental Web Search Summary (including RERA info, pricing, and social media updates):
    ${searchSummary}

    Scraped Text (from official website):
    (empty for this test)
  `;

  const extractionSchema = {
    type: Type.OBJECT,
    properties: {
      no_of_units: { type: Type.INTEGER, nullable: true },
      no_of_floors: { type: Type.INTEGER, nullable: true },
      land_area_acres: { type: Type.NUMBER, nullable: true },
      base_price_per_sft: { type: Type.NUMBER, nullable: true },
      landed_price_per_sft: { type: Type.NUMBER, nullable: true },
      construction_stage: { type: Type.STRING, nullable: true },
      handover_date: { type: Type.STRING, nullable: true },
      schemes: { type: Type.ARRAY, items: { type: Type.STRING } },
      social_ads_summary: { type: Type.STRING, nullable: true }
    }
  };

  console.log('Running extraction...');
  const aiResponse = await searchAi.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: extractionSchema
    }
  });
  console.log('Extracted Data:\n', aiResponse.text);
}
run();
