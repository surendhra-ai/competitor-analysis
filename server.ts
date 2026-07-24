import express from 'express';
import { createServer as createViteServer } from 'vite';
import Database from 'better-sqlite3';
import { GoogleGenAI, Type } from '@google/genai';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config({ override: true });

// We keep SQLite ONLY for local settings (API keys)
const db = new Database('realintel.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
  );
  CREATE TABLE IF NOT EXISTS weekly_updates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT,
      data TEXT
  );
  INSERT OR IGNORE INTO settings (key, value) VALUES ('supabaseUrl', 'https://supabase.trusync.cloud');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('supabaseKey', 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSIsImlhdCI6MTc2MTE1NjAwMCwiZXhwIjo0OTE2ODI5NjAwLCJyb2xlIjoiYW5vbiJ9.-QMXM4M6Jpr2IYdpqd2QcUioKRz4b3N90c1Rxk_RUIM');
`);

// Auto-migrate legacy or high-tier Gemini models that exceed the free quota
try {
  const currentModelRow = db.prepare("SELECT value FROM settings WHERE key = 'llmModel'").get() as any;
  if (currentModelRow) {
    const modelVal = currentModelRow.value;
    if (modelVal === 'gemini-3.1-pro-preview' || modelVal === 'gemini-3.5-flash' || modelVal === 'gemini-3-flash-preview' || modelVal === 'gemini-2.5-pro') {
      console.log(`Migrating database model setting from '${modelVal}' to 'gemini-2.5-flash' to prevent quota issues.`);
      db.prepare("UPDATE settings SET value = 'gemini-2.5-flash' WHERE key = 'llmModel'").run();
    }
  }
} catch (e) {
  console.error('Failed to run settings model migration:', e);
}

function getSupabase() {
  const urlRow = db.prepare("SELECT value FROM settings WHERE key = 'supabaseUrl'").get() as any;
  const keyRow = db.prepare("SELECT value FROM settings WHERE key = 'supabaseKey'").get() as any;
  if (!urlRow?.value || !keyRow?.value) {
    throw new Error("Supabase credentials not configured in settings.");
  }
  return createClient(urlRow.value, keyRow.value);
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  app.get('/api/env-check', (req, res) => {
    res.json({
      gemini: !!process.env.GEMINI_API_KEY,
      geminiVal: process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.substring(0, 5) : null,
      api: !!process.env.API_KEY
    });
  });

  // --- Settings ---
  app.get('/api/settings', (req, res) => {
    const settings = db.prepare('SELECT * FROM settings').all();
    const settingsMap = settings.reduce((acc: any, curr: any) => {
      acc[curr.key] = curr.value;
      return acc;
    }, {});
    res.json(settingsMap);
  });

  app.post('/api/settings', (req, res) => {
    const { firecrawlApiKey, supabaseUrl, supabaseKey, llmProvider, llmModel, geminiApiKey, openaiApiKey, reraSites } = req.body;
    const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    if (firecrawlApiKey !== undefined) stmt.run('firecrawlApiKey', firecrawlApiKey);
    if (supabaseUrl !== undefined) stmt.run('supabaseUrl', supabaseUrl);
    if (supabaseKey !== undefined) stmt.run('supabaseKey', supabaseKey);
    if (llmProvider !== undefined) stmt.run('llmProvider', llmProvider);
    if (llmModel !== undefined) stmt.run('llmModel', llmModel);
    if (geminiApiKey !== undefined) stmt.run('geminiApiKey', geminiApiKey);
    if (openaiApiKey !== undefined) stmt.run('openaiApiKey', openaiApiKey);
    if (reraSites !== undefined) stmt.run('reraSites', reraSites);
    res.json({ success: true });
  });

  // --- Weekly Updates ---
  app.get('/api/weekly_updates', (req, res) => {
    try {
      const updates = db.prepare('SELECT * FROM weekly_updates ORDER BY timestamp DESC').all();
      res.json(updates.map((u: any) => ({ ...u, data: JSON.parse(u.data) })));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/weekly_updates', (req, res) => {
    try {
      const { data } = req.body;
      const timestamp = new Date().toISOString();
      const stmt = db.prepare('INSERT INTO weekly_updates (timestamp, data) VALUES (?, ?)');
      stmt.run(timestamp, JSON.stringify(data));
      res.json({ success: true, timestamp });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/weekly_updates/:id', (req, res) => {
    try {
      const stmt = db.prepare('DELETE FROM weekly_updates WHERE id = ?');
      stmt.run(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // --- Projects ---
  app.get('/api/projects', async (req, res) => {
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase.from('projects').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/projects', async (req, res) => {
    try {
      const supabase = getSupabase();
      const { name, location, official_url, rera_registration_number } = req.body;
      const { data, error } = await supabase.from('projects').insert([{ 
        name, location, official_url, rera_registration_number 
      }]).select().single();
      if (error) throw error;
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/projects/:id', async (req, res) => {
    try {
      const supabase = getSupabase();
      const { id } = req.params;
      const { name, location, official_url, rera_registration_number } = req.body;
      const { data, error } = await supabase.from('projects')
        .update({ name, location, official_url, rera_registration_number })
        .eq('id', id)
        .select().single();
      if (error) throw error;
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/projects/:id', async (req, res) => {
    try {
      const supabase = getSupabase();
      const { id } = req.params;
      const { error } = await supabase.from('projects').delete().eq('id', id);
      if (error) throw error;
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // --- Snapshots & Deltas ---
  app.get('/api/snapshots/latest', async (req, res) => {
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('project_snapshots')
        .select('*')
        .order('scraped_at', { ascending: false });
        
      if (error) throw error;

      const latestSnapshots: any[] = [];
      const seen = new Set();
      for (const row of data) {
        if (!seen.has(row.project_id)) {
          seen.add(row.project_id);
          latestSnapshots.push(row);
        }
      }
      res.json(latestSnapshots);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/snapshots/history', async (req, res) => {
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('project_snapshots')
        .select('*')
        .order('scraped_at', { ascending: true });
        
      if (error) throw error;
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/deltas', async (req, res) => {
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('weekly_deltas')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // --- Scraping Engine ---
  app.post('/api/scrape', async (req, res) => {
    const { projectId } = req.body;
    
    try {
      const supabase = getSupabase();
      
      const { data: project, error: projError } = await supabase
        .from('projects')
        .select('*')
        .eq('id', projectId)
        .single();
        
      if (projError || !project) {
        console.error('Project not found in Supabase:', projError);
        return res.status(404).json({ error: 'Project not found in Supabase' });
      }

      const settingsRows = db.prepare("SELECT * FROM settings").all() as any[];
      const settingsMap = settingsRows.reduce((acc: any, curr: any) => {
        acc[curr.key] = curr.value;
        return acc;
      }, {});

      const firecrawlApiKey = (settingsMap.firecrawlApiKey || '').trim();
      const llmProvider = settingsMap.llmProvider || 'gemini';
      let llmModel = settingsMap.llmModel || 'gemini-2.5-flash';

      // Ensure we use gemini-2.5-flash for Gemini if the model name is legacy, paid, or incompatible
      if (llmProvider === 'gemini') {
        if (llmModel.includes('3.1') || llmModel.includes('3.5') || llmModel.includes('3-') || llmModel.includes('pro')) {
          console.log(`Overriding Gemini model setting '${llmModel}' with 'gemini-2.5-flash' to avoid quota/tier limitations.`);
          llmModel = 'gemini-2.5-flash';
        }
      }

      let geminiApiKey = (settingsMap.geminiApiKey || '').trim();
      if (geminiApiKey && !geminiApiKey.startsWith('AIzaSy')) {
        console.warn(`Database geminiApiKey '${geminiApiKey}' does not start with AIzaSy. Ignoring and falling back to process.env.GEMINI_API_KEY.`);
        geminiApiKey = '';
      }
      if (!geminiApiKey) {
        geminiApiKey = (process.env.GEMINI_API_KEY || '').trim();
      }
      if (geminiApiKey === 'MY_GEMINI_API_KEY') {
        geminiApiKey = '';
      }
      console.log('GEMINI API KEY IS:', geminiApiKey ? 'SET' : 'NOT SET', geminiApiKey ? geminiApiKey.substring(0, 5) : 'NONE');
      const openaiApiKey = (settingsMap.openaiApiKey || '').trim();

      const reraSites = settingsMap.reraSites || 'https://rera.telangana.gov.in/';

      if (!firecrawlApiKey) {
        return res.status(400).json({ error: 'Firecrawl API Key is not set in settings.' });
      }

      // 1. Scrape using Firecrawl
      let scrapedText = '';
      const urlsToScrape = project.official_url.split(',').map((u: string) => u.trim()).filter((u: string) => u);

      for (const url of urlsToScrape) {
        try {
          const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${firecrawlApiKey}`
            },
            body: JSON.stringify({
              url: url,
              formats: ['markdown']
            })
          });

          if (!response.ok) {
            console.error(`Firecrawl API error for ${url}: ${response.statusText}`);
            continue;
          }

          const data = await response.json();
          scrapedText += `\n\n--- Scraped from ${url} ---\n\n` + (data.data?.markdown || '');
        } catch (error: any) {
          console.error(`Scraping failed for ${url}:`, error);
        }
      }

      if (!scrapedText.trim()) {
        console.warn('Failed to scrape any URLs, proceeding with empty scraped text.');
      }

      // 1.5 Search Grounding with Gemini
      let searchSummary = '';
      try {
        if (geminiApiKey) {
          const searchAi = new GoogleGenAI({ apiKey: geminiApiKey });
          const searchPrompt = `
            You are an expert real estate data researcher. Your task is to find comprehensive and up-to-date details for the project "${project.name}" located in "${project.location || 'Telangana, India'}".
            ${project.rera_registration_number ? `The RERA Registration Number is ${project.rera_registration_number}.` : ''}
            
            Please use the Google Search tool to find the most accurate information from:
            1. Official RERA websites, specifically prioritizing these sites: ${reraSites}. If a RERA number is provided, you MUST search for that exact number on the RERA site to find the official project details.
            2. The official project microsite (${project.official_url})
            3. Major property portals (MagicBricks, Housing.com, 99acres, SquareYards, PropTiger).
            4. Official social media pages (Facebook, Instagram, YouTube), broker videos, or recent news articles for the project.

            You MUST find and extract the following specific data points. If you don't find them in the first search, you must try different search queries (e.g., "${project.name} price per sqft", "${project.name} construction update 2025", "${project.name} possession date RERA", "${project.name} brochure pdf", "${project.rera_registration_number} RERA details").

            Data points to find:
            - Total Number of Units/Apartments
            - Number of Floors and Towers
            - Total Land Area in Acres
            - Base Price per Sq.Ft (₹/sft) (Search for "base price", "BSP", "starting price per sqft". This is usually the lowest quoted price before amenities, floor rise, or car parking. Do not confuse with total package price. If only a total package price is given and no per-sqft price is explicitly mentioned, state "Not found" for Base Price).
            - Landed Price per Sq.Ft (₹/sft) or total package price (Search for "all inclusive price", "landed cost", "total price". This includes amenities, car parking, club house charges, etc. If you find a total package price like "1.5 Cr for 1500 sqft", calculate the landed price per sqft. If you cannot confidently calculate it because the exact area for that price is missing, state "Not found" for Landed Price).
            - Current Construction Stage (e.g., Excavation, Foundation, Superstructure, Brickwork, Finishing)
            - Expected Handover/Possession Date (Month and Year) (explicitly search for "possession date", "handover by", "completion date", or "RERA possession date". Ensure you extract the year and month if available. If multiple dates are found, prefer the RERA possession date or the latest completion date mentioned.)
            - Any active schemes, offers, or pre-launch benefits
            - Marketing focus or social media summary

            CRITICAL INSTRUCTION: Do NOT guess or hallucinate numbers. If you cannot find a specific value, explicitly state "Not found". Provide a highly detailed summary of your findings, explicitly mentioning the values for each of the data points above. If a value is an estimate or range, provide that. Do not just say "found on MagicBricks", actually provide the numbers and text.
          `;
          const searchResponse = await searchAi.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: searchPrompt,
            config: {
              tools: [{ googleSearch: {} }]
            }
          });
          searchSummary = searchResponse.text || '';
        }
      } catch (searchError: any) {
        console.error('Search grounding failed, continuing without it:', searchError?.message || String(searchError));
      }

      // Helper to call selected LLM
      async function callLLM(promptText: string, schema: any) {
        if (llmProvider === 'openai') {
          if (!openaiApiKey) throw new Error('OpenAI API Key is not set in settings.');
          const openai = new OpenAI({ apiKey: openaiApiKey });
          
          // Convert Gemini Type enum to standard JSON schema lowercase types for OpenAI
          const schemaString = JSON.stringify(schema, null, 2).replace(/"OBJECT"/g, '"object"').replace(/"STRING"/g, '"string"').replace(/"INTEGER"/g, '"integer"').replace(/"NUMBER"/g, '"number"').replace(/"ARRAY"/g, '"array"');
          
          const promptWithSchema = promptText + "\n\nReturn ONLY valid JSON matching this schema:\n" + schemaString;
          
          const response = await openai.chat.completions.create({
            model: llmModel,
            messages: [{ role: 'user', content: promptWithSchema }],
            response_format: { type: 'json_object' }
          });
          const content = response.choices[0].message.content || '{}';
          try {
            return JSON.parse(content);
          } catch (e) {
            console.error('Failed to parse OpenAI response:', content);
            throw new Error('Failed to parse LLM response as JSON');
          }
        } else {
          if (!geminiApiKey) throw new Error('Gemini API Key is not set. Please configure it in Settings or AI Studio Secrets.');
          const ai = new GoogleGenAI({ apiKey: geminiApiKey });
          try {
            const aiResponse = await ai.models.generateContent({
              model: llmModel,
              contents: promptText,
              config: {
                responseMimeType: 'application/json',
                responseSchema: schema
              }
            });
            return JSON.parse(aiResponse.text || '{}');
          } catch (error: any) {
            const errorMsg = error?.message || String(error);
            if (errorMsg.includes('API key not valid') || errorMsg.includes('API_KEY_INVALID')) {
              throw new Error('Invalid Gemini API Key. Please check your settings.');
            }
            throw error;
          }
        }
      }

      // 2. Process with LLM
      const prompt = `
        You are an expert real estate data extraction system.
        Analyze the following scraped text from a real estate project website AND the supplemental web search summary.
        Project Name: ${project.name}
        
        Extract the following information. You MUST merge the data from both sources. If the official website text is vague or missing data, heavily rely on the Supplemental Web Search Summary (which contains RERA info, portal data, and social media updates).
        
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
        ${scrapedText.substring(0, 15000)}
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

      let extractedData;
      try {
        extractedData = await callLLM(prompt, extractionSchema);
      } catch (error: any) {
        console.error('LLM extraction failed:', error);
        return res.status(400).json({ error: error.message });
      }

      // 3. Get previous snapshot to generate deltas
      const { data: previousSnapshot, error: prevSnapError } = await supabase
        .from('project_snapshots')
        .select('*')
        .eq('project_id', project.id)
        .order('scraped_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (prevSnapError) {
        console.error('Error fetching previous snapshot:', prevSnapError);
      }

      // 4. Save new snapshot
      const { error: snapError } = await supabase.from('project_snapshots').insert([{
        project_id: project.id,
        no_of_units: extractedData.no_of_units,
        no_of_floors: extractedData.no_of_floors,
        land_area_acres: extractedData.land_area_acres,
        base_price_per_sft: extractedData.base_price_per_sft,
        landed_price_per_sft: extractedData.landed_price_per_sft,
        construction_stage: extractedData.construction_stage,
        handover_date: extractedData.handover_date,
        schemes: extractedData.schemes || [],
        social_ads_summary: extractedData.social_ads_summary
      }]);
      
      if (snapError) {
        console.error('Error inserting new snapshot:', snapError);
        throw snapError;
      }

      // 5. Generate Incremental Updates (Weekly Deltas) using AI
      if (previousSnapshot) {
        const deltaPrompt = `
          Compare the previous data and current data for the real estate project "${project.name}".
          Identify any significant changes (e.g., price hikes, construction progress, new schemes).
          
          Previous Data:
          ${JSON.stringify(previousSnapshot)}
          
          Current Data:
          ${JSON.stringify(extractedData)}
          
          Return an array of changes. If there are no changes, return an empty array.
        `;

        const deltaSchema = {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              change_type: { type: Type.STRING, description: "e.g., 'Price Hike', 'Construction Progress', 'New Scheme'" },
              description: { type: Type.STRING, description: "A clear, concise sentence describing the change." }
            },
            required: ["change_type", "description"]
          }
        };

        let changes: any[] = [];
        try {
          changes = await callLLM(deltaPrompt, deltaSchema);
          if (!Array.isArray(changes)) {
            changes = [];
          }
        } catch (error: any) {
          return res.status(400).json({ error: error.message });
        }
        
        if (changes.length > 0) {
          const deltaInserts = changes.map((c: any) => ({
            project_id: project.id,
            change_type: c.change_type,
            description: c.description
          }));
          await supabase.from('weekly_deltas').insert(deltaInserts);
        }
      }

      res.json({ success: true });

    } catch (error: any) {
      console.error('Error in /api/scrape:', error);
      res.status(500).json({ error: error.message });
    }
  });


  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
