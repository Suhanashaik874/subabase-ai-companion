import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const { resumeText } = await req.json();
    if (!resumeText) return new Response(JSON.stringify({ error: 'Resume text is required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY is not configured');
    const systemPrompt = `You are an expert resume analyzer. Extract technical skills from the resume text provided.\nFor each skill, determine a proficiency level based on context clues:\n- "beginner": Mentioned briefly, coursework, learning\n- "intermediate": Work experience, projects\n- "advanced": Years of experience, lead roles, expert\nReturn a JSON object with a "skills" array containing objects with "name" (string) and "level" (string) properties.\nFocus on programming languages, frameworks, databases, cloud services, tools, and concepts.\nOnly return valid JSON.`;
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', { method: 'POST', headers: { 'Authorization': `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'google/gemini-3-flash-preview', messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: `Extract skills from this resume:\n\n${resumeText.slice(0, 8000)}` }], response_format: { type: 'json_object' } }) });
    if (!response.ok) { if (response.status === 429) return new Response(JSON.stringify({ error: 'Rate limit exceeded.' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); throw new Error('AI gateway error'); }
    const data = await response.json();
    let skills = [];
    try { skills = JSON.parse(data.choices?.[0]?.message?.content).skills || []; } catch { const matches = resumeText.match(/\b(python|javascript|typescript|java|c\+\+|react|angular|vue|node\.js|docker|kubernetes|git|sql|mongodb|postgresql|mysql|html|css|aws|azure|gcp)\b/gi); if (matches) { const unique = [...new Set(matches.map((s: string) => s.toLowerCase()))] as string[]; skills = unique.map(name => ({ name: name.charAt(0).toUpperCase() + name.slice(1), level: 'intermediate' })); } }
    return new Response(JSON.stringify({ skills }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) { return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
});
