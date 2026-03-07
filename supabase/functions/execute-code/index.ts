import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const PAIZA_CREATE_URL = 'https://api.paiza.io/runners/create';
const PAIZA_DETAILS_URL = 'https://api.paiza.io/runners/get_details';

const languageMap: Record<string, string> = {
  javascript: 'javascript',
  typescript: 'typescript',
  python: 'python3',
  java: 'java',
  'c++': 'cpp',
  c: 'c',
  go: 'go',
  rust: 'rust',
  ruby: 'ruby',
  php: 'php',
};

// No wrapping needed - user code reads from stdin directly

async function executeCode(code: string, language: string, stdin = ''): Promise<{ output: string; error: boolean }> {
  const lang = languageMap[language] || 'javascript';

  // Step 1: Create execution
  const createResp = await fetch(PAIZA_CREATE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source_code: code,
      language: lang,
      input: stdin,
      api_key: 'guest',
    }),
  });

  if (!createResp.ok) {
    throw new Error(`PaizaIO create error: ${createResp.status}`);
  }

  const createData = await createResp.json();
  const sessionId = createData.id;

  // Step 2: Poll for results (max 15 seconds)
  let attempts = 0;
  while (attempts < 30) {
    await new Promise(r => setTimeout(r, 500));
    const detailsResp = await fetch(`${PAIZA_DETAILS_URL}?id=${sessionId}&api_key=guest`);
    if (!detailsResp.ok) {
      throw new Error(`PaizaIO details error: ${detailsResp.status}`);
    }
    const details = await detailsResp.json();
    
    if (details.status === 'completed') {
      const stdout = (details.stdout || '').trim();
      const stderr = (details.stderr || '').trim();
      const buildStderr = (details.build_stderr || '').trim();
      const hasError = !!stderr || !!buildStderr || details.exit_code !== 0;
      
      return {
        output: stdout || stderr || buildStderr || 'No output',
        error: hasError && !stdout,
      };
    }
    attempts++;
  }

  throw new Error('Execution timed out');
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
      const result = await executeCode(code, language || 'javascript');
      return new Response(JSON.stringify({
        output: result.output,
        testResults: [],
        exitCode: result.error ? 1 : 0,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const testResults = [];
    const outputs: string[] = [];

    for (let i = 0; i < testCases.length; i++) {
      const tc = testCases[i];
      const stdin = typeof tc.input === 'string' ? tc.input : JSON.stringify(tc.input);
      
      try {
        // Pass test input as stdin - user code should read from stdin
        const result = await executeCode(code, language || 'javascript', stdin);
        const actual = result.output;
        const expected = (typeof tc.expected_output === 'string' ? tc.expected_output : JSON.stringify(tc.expected_output)).trim();
        const passed = actual === expected;

        testResults.push({ case: i + 1, input: stdin, expected, actual, passed });
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
