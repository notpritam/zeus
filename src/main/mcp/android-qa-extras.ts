import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFile, writeFile } from 'fs/promises';
import { execFile } from 'child_process';

const LOGCAT_STATE_PATH = '/tmp/zeus-android-logcat-state.json';
const LEVEL_ORDER: Record<string, number> = { V: 0, D: 1, I: 2, W: 3, E: 4, F: 5 };

// Cursor tracking for since_last_call
let lastReadIndex = 0;

const server = new McpServer({
  name: 'android-qa-extras',
  version: '1.0.0',
});

// ─── Tool: android_qa_logcat ───

server.tool(
  'android_qa_logcat',
  'Read recent Android logcat entries from the emulator. Defaults to Info+ level.',
  {
    limit: z.number().optional().default(50).describe('Max entries to return'),
    level: z.enum(['V', 'D', 'I', 'W', 'E', 'F']).optional().default('I').describe('Minimum log level'),
    tag: z.string().optional().describe('Filter by tag name'),
    since_last_call: z.boolean().optional().default(false).describe('Only return entries since last call'),
  },
  async ({ limit, level, tag, since_last_call }) => {
    try {
      const raw = await readFile(LOGCAT_STATE_PATH, 'utf-8');
      const state = JSON.parse(raw) as { entries: Array<{ timestamp: number; pid: number; tid: number; level: string; tag: string; message: string }>; updatedAt: number };
      let entries = state.entries;

      // Cursor-based filtering
      if (since_last_call) {
        entries = entries.slice(lastReadIndex);
      }

      // Level filtering
      const minLevel = LEVEL_ORDER[level] ?? 2;
      entries = entries.filter(e => (LEVEL_ORDER[e.level] ?? 0) >= minLevel);

      // Tag filtering
      if (tag) {
        entries = entries.filter(e => e.tag === tag);
      }

      // Limit
      entries = entries.slice(-limit);

      // Update cursor
      lastReadIndex = state.entries.length;

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ entries, total: entries.length }) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ entries: [], total: 0, error: 'No logcat data available yet' }) }],
      };
    }
  }
);

// ─── Tool: android_qa_device_info ───

server.tool(
  'android_qa_device_info',
  'Get device properties (model, API level, screen size, Android version).',
  {},
  async () => {
    const deviceId = process.env.ZEUS_ANDROID_DEVICE_ID;
    if (!deviceId) {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No device ID set' }) }] };
    }

    const getprop = (prop: string): Promise<string> => {
      return new Promise((resolve) => {
        execFile('adb', ['-s', deviceId, 'shell', 'getprop', prop], { timeout: 5000 }, (err, stdout) => {
          resolve(err ? '' : stdout.trim());
        });
      });
    };

    const [model, apiLevel, androidVersion, screenDensity] = await Promise.all([
      getprop('ro.product.model'),
      getprop('ro.build.version.sdk'),
      getprop('ro.build.version.release'),
      getprop('ro.sf.lcd_density'),
    ]);

    // Get screen size via wm size
    const screenSize = await new Promise<string>((resolve) => {
      execFile('adb', ['-s', deviceId, 'shell', 'wm', 'size'], { timeout: 5000 }, (err, stdout) => {
        resolve(err ? '' : stdout.trim().replace('Physical size: ', ''));
      });
    });

    return {
      content: [{ type: 'text' as const, text: JSON.stringify({
        deviceId,
        model,
        apiLevel: parseInt(apiLevel, 10) || null,
        androidVersion,
        screenSize,
        screenDensity: parseInt(screenDensity, 10) || null,
      }) }],
    };
  }
);

// ─── Tool: android_qa_finish ───

server.tool(
  'android_qa_finish',
  'Signal QA completion. MUST be called when testing is done.',
  {
    summary: z.string().describe('Summary of test findings'),
    status: z.enum(['pass', 'fail', 'warning']).describe('Overall test status'),
  },
  async ({ summary, status }) => {
    const agentId = process.env.ZEUS_QA_AGENT_ID;
    if (!agentId) {
      return { content: [{ type: 'text' as const, text: 'Error: ZEUS_QA_AGENT_ID not set' }], isError: true };
    }

    const finishPath = `/tmp/zeus-qa-finish-${agentId}.json`;
    await writeFile(finishPath, JSON.stringify({ summary, status, timestamp: Date.now() }));

    return {
      content: [{ type: 'text' as const, text: `QA finished: ${status}. Summary saved to ${finishPath}` }],
    };
  }
);

// ─── Start Server ───

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[android-qa-extras] MCP server running on stdio');
}

main().catch(console.error);
