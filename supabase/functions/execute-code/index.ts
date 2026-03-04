import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { code, language, testCases } = await req.json();
    if (!code) {
      return new Response(JSON.stringify({ error: 'Code is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY is not configured');

    const hasTestCases = Array.isArray(testCases) && testCases.length > 0;

    const prompt = hasTestCases
      ? `You are a code execution engine. Execute the following ${language || 'javascript'} code against each test case. 

CODE:
\`\`\`${language || 'javascript'}
${code}
\`\`\`

TEST CASES:
${testCases.map((tc: any, i: number) => `Case ${i + 1}: Input: ${JSON.stringify(tc.input)} | Expected Output: ${JSON.stringify(tc.expected_output)}`).join('\n')}

Execute the code for each test case. Return JSON:
{
  "output": "console output from running the code",
  "testResults": [
    { "case": 1, "input": "...", "expected": "...", "actual": "...", "passed": true/false }
  ]
}

IMPORTANT: Actually trace through the code logic step by step to determine the real output for each input. The "actual" field must contain what the code would actually return/print for that input. Be precise and accurate.`
      : `You are a code execution engine. Execute the following ${language || 'javascript'} code and return the exact output.

CODE:
\`\`\`${language || 'javascript'}
${code}
\`\`\`

Return JSON: { "output": "exact console/print output", "testResults": [] }
Trace through the code precisely. Include all print/console.log output. If there's an error, show the error message.`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          { role: 'system', content: 'You are a precise code execution engine. Always return valid JSON only. No markdown, no explanations.' },
          { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) throw new Error(`AI gateway error: ${response.status}`);

    const data = await response.json();
    let result = { output: 'No output', testResults: [] };

    try {
      result = JSON.parse(data.choices?.[0]?.message?.content || '{}');
    } catch {
      result = { output: data.choices?.[0]?.message?.content || 'No output', testResults: [] };
    }

    return new Response(JSON.stringify({
      output: result.output || 'No output',
      testResults: result.testResults || [],
      exitCode: 0,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      output: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      testResults: [],
      exitCode: 1,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
