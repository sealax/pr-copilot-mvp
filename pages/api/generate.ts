import OpenAI from 'openai';

import { createClient } from '@supabase/supabase-js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { prompt } = req.body;

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Missing prompt' });
    }

    const system = `You are a senior tech PR professional.
Write crisp, credible press releases. Avoid hype and generic advice.
If key details are missing, make minimal reasonable assumptions and mark them as [TBD].`;

    const user = `Create a press release draft based on the announcement brief below.

Output format:
1) HEADLINE (max 14 words)
2) SUBHEAD (max 22 words)
3) BODY (250–450 words, AP-style, short paragraphs, Do NOT include quotes in the body text.)
4) QUOTE (1 founder/executive quote, 2–3 sentences)
5) BOILERPLATE (2–3 sentences)
6) MEDIA CONTACT (Name, email, phone as [TBD] if unknown)

Brief:
${prompt}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.6,
    });

    const text = completion.choices?.[0]?.message?.content ?? '';

    const { data, error } = await supabase
      .from("generations")
      .insert({
        prompt,
        output: text,
        model: "gpt-4o-mini",
      })
      .select()
      .single();

    if (error) {
      console.error("Supabase insert error:", error);
    }

    return res.status(200).json({
      response: text,
      generation_id: data?.id ?? null,
    });

  } catch (err) {
    console.error('API error:', err);
    return res.status(500).json({ error: 'Something went wrong on the server.' });
  }
}
