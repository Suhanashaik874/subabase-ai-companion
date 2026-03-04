import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version' };
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const { interviewId, questionsData } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY is not configured');
    let { data: questions, error: fetchError } = await supabase.from('interview_questions').select('*').eq('interview_id', interviewId);
    if (fetchError) throw fetchError;
    if ((!questions || questions.length === 0) && questionsData?.length) {
      const { data: savedQ, error: saveErr } = await supabase.from('interview_questions').insert(questionsData.map((q: any) => ({ interview_id: interviewId, question_type: q.question_type || 'hr', difficulty: q.difficulty || 'medium', question_text: q.question_text, expected_answer: q.expected_answer || '', user_answer: q.user_answer || '', user_code: q.user_code || null }))).select();
      if (!saveErr) questions = savedQ;
    }
    if (!questions?.length) return new Response(JSON.stringify({ totalScore: 0, maxScore: 0, feedback: 'No questions found.', error: 'no_questions' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    let totalScore = 0, maxScore = 0;
    const pointsMap: Record<string, number> = { easy: 10, medium: 20, hard: 30 };
    const evaluations = await Promise.all(questions.map(async (question: any) => {
      const maxPoints = pointsMap[question.difficulty] || 20;
      maxScore += maxPoints;
      let evalPrompt = question.question_type === 'coding'
        ? `Evaluate coding solution:\nQuestion: ${question.question_text}\nCode:\n\`\`\`\n${question.user_code || 'No code'}\n\`\`\`\nReturn JSON: score (0-100), is_correct (bool), feedback (markdown), optimal_solution, time_complexity, space_complexity, areas_to_improve (array).`
        : question.question_type === 'hr'
        ? `Evaluate HR response:\nQuestion: ${question.question_text}\nAnswer: ${question.user_answer || 'No answer'}\nReturn JSON: score (0-100), is_correct (bool), feedback (markdown), areas_to_improve (array).`
        : `Evaluate aptitude answer:\nQuestion: ${question.question_text}\nAnswer: ${question.user_answer || 'No answer'}\nExpected: ${question.expected_answer || 'N/A'}\nReturn JSON with these exact fields: "score" (100 if correct else 0), "is_correct" (boolean), "feedback" (detailed markdown explanation), "solution_steps" (a markdown string with numbered step-by-step solution, must not be empty), "areas_to_improve" (array of strings with improvement suggestions).`;
      try {
        const r = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', { method: 'POST', headers: { 'Authorization': `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'google/gemini-3-flash-preview', messages: [{ role: 'system', content: 'You are a fair technical interviewer. Return only valid JSON.' }, { role: 'user', content: evalPrompt }], response_format: { type: 'json_object' } }) });
        if (!r.ok) return { question, evaluation: null, maxPoints };
        const evaluation = JSON.parse((await r.json()).choices?.[0]?.message?.content);
        return { question, evaluation, maxPoints };
      } catch { return { question, evaluation: null, maxPoints }; }
    }));
    for (const { question, evaluation, maxPoints } of evaluations) {
      const score = evaluation ? Math.round((evaluation.score / 100) * maxPoints) : 0;
      totalScore += score;
      const enriched = evaluation ? { feedback: evaluation.feedback || '', optimal_solution: evaluation.optimal_solution || null, time_complexity: evaluation.time_complexity || null, space_complexity: evaluation.space_complexity || null, solution_steps: evaluation.solution_steps || null, areas_to_improve: evaluation.areas_to_improve || [] } : { feedback: 'Evaluation not available' };
      await supabase.from('interview_questions').update({ is_correct: evaluation?.is_correct ?? false, score, ai_feedback: JSON.stringify(enriched) }).eq('id', question.id);
    }
    const fbR = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', { method: 'POST', headers: { 'Authorization': `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'google/gemini-3-flash-preview', messages: [{ role: 'system', content: 'You are an encouraging interview coach. Return only valid JSON.' }, { role: 'user', content: `Score: ${totalScore}/${maxScore} (${Math.round((totalScore/maxScore)*100)}%). Provide brief overall feedback. Return JSON with "feedback" string.` }], response_format: { type: 'json_object' } }) });
    let overallFeedback = 'Keep practicing to improve!';
    if (fbR.ok) { try { overallFeedback = JSON.parse((await fbR.json()).choices?.[0]?.message?.content).feedback || overallFeedback; } catch {} }
    return new Response(JSON.stringify({ totalScore, maxScore, feedback: overallFeedback }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) { return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
});
