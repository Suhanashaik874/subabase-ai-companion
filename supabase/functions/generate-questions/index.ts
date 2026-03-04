import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version' };
interface Skill { skill_name: string; proficiency_level: 'beginner' | 'intermediate' | 'advanced'; }
function getDifficultyFromLevel(level: string): string { switch (level) { case 'beginner': return 'easy'; case 'intermediate': return 'medium'; case 'advanced': return 'hard'; default: return 'medium'; } }
function buildHRPrompt(numQuestions: number, resumeText?: string, skills?: Skill[]): string {
  let context = '';
  if (resumeText?.trim()) context += `\nCANDIDATE'S RESUME:\n${resumeText.slice(0, 6000)}\n`;
  if (skills?.length) context += `\nSKILLS: ${skills.map(s => `${s.skill_name} (${s.proficiency_level})`).join(', ')}\n`;
  return `You are an expert HR interviewer generating personalized behavioral questions.${context}\nGenerate ${numQuestions} HR/behavioral questions. Mix behavioral (STAR method), situational, and technical decision-making questions.\nFor each: question_type: "hr", difficulty: "easy"|"medium"|"hard", question_text, expected_answer.\nReturn only valid JSON with a "questions" array.`;
}
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const { interviewType, skills, interviewId, difficulty, language, resumeText } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY is not configured');
    const numQuestions = interviewType === 'combined' ? 6 : 4;
    const skillsList = skills as Skill[];
    const selectedLang = language || 'javascript';
    const selectedDifficulty = difficulty || 'adaptive';
    let systemPrompt = '';
    if (interviewType === 'coding' || interviewType === 'combined') {
      const codingDiff = selectedDifficulty !== 'adaptive' ? `All questions should be ${selectedDifficulty} difficulty.` : `Match difficulty to skill levels:\n${skillsList.map((s: Skill) => `- ${s.skill_name}: ${getDifficultyFromLevel(s.proficiency_level)}`).join('\n')}`;
      systemPrompt = `You are an expert technical interviewer generating ${selectedLang.toUpperCase()} coding questions.\nGenerate ${interviewType === 'combined' ? 3 : numQuestions} unique coding questions.\nLanguage: ${selectedLang}\n${codingDiff}\nEach question must include context, problem statement, examples, constraints.\nEach coding question MUST include a "test_cases" array with 3 test cases. Each test case: { "input": "description of input", "expected_output": "expected output value" }.\nReturn JSON with "questions" array. Each: question_type: "coding", skill_name: "${selectedLang}", difficulty, question_text (markdown), expected_answer, test_cases.`;
    }
    if (interviewType === 'aptitude' || interviewType === 'combined') {
      const aptDiff = selectedDifficulty !== 'adaptive' ? `All ${selectedDifficulty} difficulty.` : 'Vary difficulty.';
      systemPrompt += `\n${interviewType === 'combined' ? 'Also generate' : 'Generate'} ${interviewType === 'combined' ? 3 : numQuestions} aptitude questions.\nCRITICAL: Each MUST include exactly 4 options.\n${aptDiff}\nFor aptitude: question_type: "aptitude"|"logical"|"verbal", difficulty, question_text, options: ["A","B","C","D"], expected_answer (exact match).`;
    }
    if (interviewType === 'hr') systemPrompt = buildHRPrompt(numQuestions, resumeText, skillsList);
    systemPrompt += '\nReturn only valid JSON with a "questions" array. Ensure all aptitude questions have exactly 4 options.';
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', { method: 'POST', headers: { 'Authorization': `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'google/gemini-3-flash-preview', messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: `Generate interview questions. ID: ${interviewId}. Timestamp: ${Date.now()}` }], response_format: { type: 'json_object' } }) });
    if (!response.ok) { if (response.status === 429) return new Response(JSON.stringify({ error: 'Rate limit exceeded.' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); throw new Error('AI gateway error'); }
    const data = await response.json();
    let questions = [];
    try { questions = JSON.parse(data.choices?.[0]?.message?.content).questions || []; questions = questions.map((q: any) => { if (q.question_type !== 'coding' && q.question_type !== 'hr' && (!Array.isArray(q.options) || q.options.length !== 4)) q.options = ['Option A', 'Option B', 'Option C', 'Option D']; return q; }); } catch { questions = [{ question_type: interviewType === 'hr' ? 'hr' : 'coding', difficulty: 'medium', question_text: 'Tell me about a challenging project you worked on.', expected_answer: 'Use STAR method.' }]; }
    return new Response(JSON.stringify({ questions }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) { return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
});
