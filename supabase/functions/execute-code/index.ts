import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const PISTON_URL = 'https://emkc.org/api/v2/piston/execute';

const languageVersions: Record<string, { language: string; version: string }> = {
  javascript: { language: 'javascript', version: '18.15.0' },
  typescript: { language: 'typescript', version: '5.0.3' },
  python: { language: 'python', version: '3.10.0' },
  java: { language: 'java', version: '15.0.2' },
  'c++': { language: 'c++', version: '10.2.0' },
  c: { language: 'c', version: '10.2.0' },
  go: { language: 'go', version: '1.16.2' },
  rust: { language: 'rust', version: '1.68.2' },
  ruby: { language: 'ruby', version: '3.0.1' },
  php: { language: 'php', version: '8.2.3' },
};

async function executeCode(code: string, language: string, stdin = ''): Promise<{ output: string; error: boolean }> {
  const langConfig = languageVersions[language] || languageVersions['javascript'];
  
  const response = await fetch(PISTON_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      language: langConfig.language,
      version: langConfig.version,
      files: [{ content: code }],
      stdin,
      run_timeout: 10000,
    }),
  });

  if (!response.ok) {
    throw new Error(`Piston API error: ${response.status}`);
  }

  const data = await response.json();
  const run = data.run || {};
  const output = (run.stdout || '').trim();
  const stderr = (run.stderr || '').trim();
  const hasError = run.code !== 0 || !!stderr;

  return {
    output: output || stderr || 'No output',
    error: hasError && !output,
  };
}

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

    const hasTestCases = Array.isArray(testCases) && testCases.length > 0;

    if (!hasTestCases) {
      // Simple execution without test cases
      const result = await executeCode(code, language || 'javascript');
      return new Response(JSON.stringify({
        output: result.output,
        testResults: [],
        exitCode: result.error ? 1 : 0,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Run code against each test case
    const testResults = [];
    const outputs: string[] = [];

    for (let i = 0; i < testCases.length; i++) {
      const tc = testCases[i];
      const stdin = typeof tc.input === 'string' ? tc.input : JSON.stringify(tc.input);
      
      try {
        const result = await executeCode(code, language || 'javascript', stdin);
        const actual = result.output;
        const expected = (typeof tc.expected_output === 'string' ? tc.expected_output : JSON.stringify(tc.expected_output)).trim();
        const passed = actual === expected;

        testResults.push({
          case: i + 1,
          input: stdin,
          expected,
          actual,
          passed,
        });
        outputs.push(`Case ${i + 1}: ${actual}`);
      } catch (err) {
        testResults.push({
          case: i + 1,
          input: stdin,
          expected: typeof tc.expected_output === 'string' ? tc.expected_output : JSON.stringify(tc.expected_output),
          actual: `Error: ${err instanceof Error ? err.message : 'Execution failed'}`,
          passed: false,
        });
        outputs.push(`Case ${i + 1}: Error`);
      }
    }

    return new Response(JSON.stringify({
      output: outputs.join('\n'),
      testResults,
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
