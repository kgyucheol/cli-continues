import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UnifiedSession } from '../types/index.js';

const tempDirs: string[] = [];

function makeCodexHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-parser-'));
  tempDirs.push(dir);
  return dir;
}

function writeRollout(root: string, subdir: string, filename: string, rows: unknown[]): string {
  const targetDir = path.join(root, subdir);
  fs.mkdirSync(targetDir, { recursive: true });
  const fullPath = path.join(targetDir, filename);
  fs.writeFileSync(fullPath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  return fullPath;
}

async function loadCodexParser(home: string): Promise<typeof import('../parsers/codex.js')> {
  vi.resetModules();
  vi.stubEnv('CODEX_HOME', home);
  return import('../parsers/codex.js');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

describe('codex parser hardening', () => {
  it('discovers sessions from both active and archived session trees', async () => {
    const home = makeCodexHome();

    writeRollout(
      home,
      path.join('sessions', '2026', '04', '15'),
      'rollout-2026-04-15T10-00-00-active-session-id.jsonl',
      [
        {
          timestamp: '2026-04-15T10:00:00.000Z',
          type: 'session_meta',
          payload: { id: 'active-session-id', cwd: '/tmp/active' },
        },
        {
          timestamp: '2026-04-15T10:00:01.000Z',
          type: 'event_msg',
          payload: { type: 'user_message', message: 'Active session' },
        },
      ],
    );

    writeRollout(
      home,
      path.join('archived_sessions', '2026', '04', '14'),
      'rollout-2026-04-14T09-00-00-archived-session-id.jsonl',
      [
        {
          timestamp: '2026-04-14T09:00:00.000Z',
          type: 'session_meta',
          payload: { id: 'archived-session-id', cwd: '/tmp/archived' },
        },
        {
          timestamp: '2026-04-14T09:00:01.000Z',
          type: 'event_msg',
          payload: { type: 'user_message', message: 'Archived session' },
        },
      ],
    );

    const { parseCodexSessions } = await loadCodexParser(home);
    const sessions = await parseCodexSessions();

    expect(sessions.map((session) => session.id)).toContain('active-session-id');
    expect(sessions.map((session) => session.id)).toContain('archived-session-id');
  });

  it('extracts token usage from nested token_count payload.info totals', async () => {
    const home = makeCodexHome();
    const originalPath = writeRollout(
      home,
      path.join('sessions', '2026', '04', '15'),
      'rollout-2026-04-15T10-00-00-token-session-id.jsonl',
      [
        {
          timestamp: '2026-04-15T10:00:00.000Z',
          type: 'session_meta',
          payload: {
            id: 'token-session-id',
            cwd: '/tmp/project',
            git: { branch: 'main', repository_url: 'https://github.com/user/project.git' },
          },
        },
        {
          timestamp: '2026-04-15T10:00:01.000Z',
          type: 'response_item',
          payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Token check' }] },
        },
        {
          timestamp: '2026-04-15T10:00:02.000Z',
          type: 'response_item',
          payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done.' }] },
        },
        {
          timestamp: '2026-04-15T10:00:03.000Z',
          type: 'event_msg',
          payload: {
            type: 'token_count',
            info: {
              total_token_usage: {
                input_tokens: 120,
                output_tokens: 45,
                cached_input_tokens: 17,
                reasoning_output_tokens: 9,
              },
              last_token_usage: {
                input_tokens: 20,
                output_tokens: 5,
                cached_input_tokens: 2,
                reasoning_output_tokens: 1,
              },
            },
          },
        },
      ],
    );

    const { extractCodexContext } = await loadCodexParser(home);
    const session: UnifiedSession = {
      id: 'token-session-id',
      source: 'codex',
      cwd: '/tmp/project',
      repo: 'user/project',
      branch: 'main',
      lines: 4,
      bytes: fs.statSync(originalPath).size,
      createdAt: new Date('2026-04-15T10:00:00.000Z'),
      updatedAt: new Date('2026-04-15T10:00:03.000Z'),
      originalPath,
      summary: 'Token check',
    };

    const context = await extractCodexContext(session);

    expect(context.sessionNotes?.tokenUsage).toEqual({ input: 120, output: 45 });
    expect(context.sessionNotes?.cacheTokens).toEqual({ creation: 0, read: 17 });
    expect(context.sessionNotes?.thinkingTokens).toBe(9);
  });

  it('extracts plaintext compacted payload.message as compact summary', async () => {
    const home = makeCodexHome();
    const originalPath = writeRollout(
      home,
      path.join('sessions', '2026', '04', '15'),
      'rollout-2026-04-15T10-00-00-compact-session-id.jsonl',
      [
        {
          timestamp: '2026-04-15T10:00:00.000Z',
          type: 'session_meta',
          payload: { id: 'compact-session-id', cwd: '/tmp/project' },
        },
        {
          timestamp: '2026-04-15T10:00:01.000Z',
          type: 'compacted',
          payload: {
            message: 'Keep the parser findings and pending fixes.',
            replacement_history: [{ content: 'do not include this injected content' }],
          },
        },
      ],
    );

    const { extractCodexContext } = await loadCodexParser(home);
    const context = await extractCodexContext({
      id: 'compact-session-id',
      source: 'codex',
      cwd: '/tmp/project',
      lines: 2,
      bytes: fs.statSync(originalPath).size,
      createdAt: new Date('2026-04-15T10:00:00.000Z'),
      updatedAt: new Date('2026-04-15T10:00:01.000Z'),
      originalPath,
    });

    expect(context.sessionNotes?.compactSummary).toBe('Keep the parser findings and pending fixes.');
    expect(context.sessionNotes?.compactSummary).not.toContain('injected');
  });

  it('tracks namespaced edit_file function calls as edits and modified files', async () => {
    const home = makeCodexHome();
    const originalPath = writeRollout(
      home,
      path.join('sessions', '2026', '04', '15'),
      'rollout-2026-04-15T10-00-00-edit-file-session-id.jsonl',
      [
        {
          timestamp: '2026-04-15T10:00:00.000Z',
          type: 'session_meta',
          payload: { id: 'edit-file-session-id', cwd: '/tmp/project' },
        },
        {
          timestamp: '2026-04-15T10:00:01.000Z',
          type: 'response_item',
          payload: {
            type: 'function_call',
            name: 'edit_file',
            namespace: 'mcp__morph__',
            call_id: 'call-edit',
            arguments: JSON.stringify({
              path: 'src/parsers/codex.ts',
              code_edit: '// ... existing code ...\nconst fixed = true;',
            }),
          },
        },
        {
          timestamp: '2026-04-15T10:00:02.000Z',
          type: 'response_item',
          payload: { type: 'function_call_output', call_id: 'call-edit', output: 'updated' },
        },
      ],
    );

    const { extractCodexContext } = await loadCodexParser(home);
    const context = await extractCodexContext({
      id: 'edit-file-session-id',
      source: 'codex',
      cwd: '/tmp/project',
      lines: 3,
      bytes: fs.statSync(originalPath).size,
      createdAt: new Date('2026-04-15T10:00:00.000Z'),
      updatedAt: new Date('2026-04-15T10:00:02.000Z'),
      originalPath,
    });

    expect(context.filesModified).toContain('src/parsers/codex.ts');
    const editSummary = context.toolSummaries.find((summary) => summary.name === 'mcp__morph__edit_file');
    expect(editSummary?.samples[0].data).toMatchObject({
      category: 'edit',
      filePath: 'src/parsers/codex.ts',
    });
  });

  it('summarizes write_stdin chars payloads', async () => {
    const home = makeCodexHome();
    const originalPath = writeRollout(
      home,
      path.join('sessions', '2026', '04', '15'),
      'rollout-2026-04-15T10-00-00-stdin-session-id.jsonl',
      [
        {
          timestamp: '2026-04-15T10:00:00.000Z',
          type: 'session_meta',
          payload: { id: 'stdin-session-id', cwd: '/tmp/project' },
        },
        {
          timestamp: '2026-04-15T10:00:01.000Z',
          type: 'response_item',
          payload: {
            type: 'function_call',
            name: 'write_stdin',
            arguments: JSON.stringify({ chars: 'y\n' }),
          },
        },
      ],
    );

    const { extractCodexContext } = await loadCodexParser(home);
    const context = await extractCodexContext({
      id: 'stdin-session-id',
      source: 'codex',
      cwd: '/tmp/project',
      lines: 2,
      bytes: fs.statSync(originalPath).size,
      createdAt: new Date('2026-04-15T10:00:00.000Z'),
      updatedAt: new Date('2026-04-15T10:00:01.000Z'),
      originalPath,
    });

    const stdinSummary = context.toolSummaries.find((summary) => summary.name === 'write_stdin');
    expect(stdinSummary?.samples[0].summary).toContain('y');
  });

  it('uses session_meta and rollout timestamps while keeping task_started out of tool summaries', async () => {
    const home = makeCodexHome();
    const originalPath = writeRollout(
      home,
      path.join('sessions', '2026', '04', '15'),
      'rollout-2026-04-15T09-00-00-lifecycle-session-id.jsonl',
      [
        {
          timestamp: '2026-04-15T10:00:00.000Z',
          type: 'session_meta',
          payload: {
            id: 'lifecycle-session-id',
            timestamp: '2026-04-15T09:59:58.500Z',
            cwd: '/tmp/project',
            originator: 'codex_cli_rs',
            cli_version: '0.99.0',
            source: 'vscode',
            model_provider: 'openai',
            git: {
              branch: 'main',
              repository_url: 'https://github.com/user/project.git',
              commit_hash: '1234567890abcdef',
            },
          },
        },
        {
          timestamp: '2026-04-15T10:00:01.000Z',
          type: 'event_msg',
          payload: {
            type: 'task_started',
            message: 'working',
            turn_id: 'turn-1',
            started_at: 1776077875,
            model_context_window: 200000,
            collaboration_mode_kind: 'default',
          },
        },
        {
          timestamp: '2026-04-15T10:00:02.000Z',
          type: 'event_msg',
          payload: {
            type: 'turn_aborted',
            message: 'interrupted',
            reason: 'interrupted',
            completed_at: 1776077876,
            duration_ms: 47,
          },
        },
      ],
    );

    const { parseCodexSessions, extractCodexContext } = await loadCodexParser(home);
    const [session] = await parseCodexSessions();
    const context = await extractCodexContext(session);

    expect(originalPath).toContain('lifecycle-session-id');
    expect(session.createdAt.toISOString()).toBe('2026-04-15T09:59:58.500Z');
    expect(session.updatedAt.toISOString()).toBe('2026-04-15T10:00:02.000Z');
    expect(session.gitSha).toBe('1234567890abcdef');
    expect(context.toolSummaries.find((summary) => summary.name === 'task')).toBeUndefined();
    expect(context.sessionNotes?.lifecycle?.map((entry) => entry.type)).toEqual(['task_started', 'turn_aborted']);
    expect(context.sessionNotes?.lifecycle?.[0].metadata).toMatchObject({
      started_at: 1776077875,
      model_context_window: 200000,
      collaboration_mode_kind: 'default',
    });
    expect(context.sessionNotes?.lifecycle?.[1].metadata).toMatchObject({
      reason: 'interrupted',
      completed_at: 1776077876,
      duration_ms: 47,
    });
    expect(context.sessionNotes?.sourceMetadata).toMatchObject({
      sessionTimestamp: '2026-04-15T09:59:58.500Z',
      rolloutTimestamp: '2026-04-15T10:00:00.000Z',
      source: 'vscode',
      originator: 'codex_cli_rs',
      cliVersion: '0.99.0',
      modelProvider: 'openai',
    });
    // task_started/task_complete carry no content; only interruptions are worth a slot in Recent Conversation
    expect(context.markdown).toContain('Lifecycle turn_aborted');
    expect(context.markdown).not.toContain('Lifecycle task_started');
    expect(context.markdown).not.toContain('### Task');
  });

  it('falls back to git.sha when commit_hash is absent (covers both UnifiedSession and SessionNotes.sourceMetadata)', async () => {
    const home = makeCodexHome();
    const originalPath = writeRollout(
      home,
      path.join('sessions', '2026', '04', '15'),
      'rollout-2026-04-15T11-00-00-shaonly-session-id.jsonl',
      [
        {
          timestamp: '2026-04-15T11:00:00.000Z',
          type: 'session_meta',
          payload: {
            id: 'shaonly-session-id',
            cwd: '/tmp/project',
            git: {
              branch: 'main',
              repository_url: 'https://github.com/user/project.git',
              sha: 'fedcba0987654321',
            },
          },
        },
        {
          timestamp: '2026-04-15T11:00:01.000Z',
          type: 'event_msg',
          payload: { type: 'user_message', message: 'hello' },
        },
      ],
    );

    const { parseCodexSessions, extractCodexContext } = await loadCodexParser(home);
    const [session] = await parseCodexSessions();
    const context = await extractCodexContext(session);

    expect(originalPath).toContain('shaonly-session-id');
    expect(session.gitSha).toBe('fedcba0987654321');
    expect(context.sessionNotes?.sourceMetadata).toMatchObject({ gitSha: 'fedcba0987654321' });
  });
});

// Shapes below mirror real Codex Desktop rollouts (cli_version 0.153): tools run inside an `exec`
// JS wrapper, and the structured result of each tool lands in `event_msg` → `item_completed`.
describe('codex desktop rollout format', () => {
  const desktopMeta = (id: string, extra: Record<string, unknown> = {}) => ({
    timestamp: '2026-09-28T10:00:00.000Z',
    ordinal: 0,
    type: 'session_meta',
    payload: {
      session_id: id,
      id,
      timestamp: '2026-09-28T10:00:00.000Z',
      cwd: '/tmp/desktop-project',
      originator: 'Codex Desktop',
      cli_version: '0.153.0-alpha.5',
      source: 'vscode',
      thread_source: 'user',
      model_provider: 'openai',
      ...extra,
    },
  });

  const userItem = (timestamp: string, text: string) => ({
    timestamp,
    type: 'response_item',
    payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
  });

  const assistantItem = (timestamp: string, text: string) => ({
    timestamp,
    type: 'response_item',
    payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] },
  });

  const completed = (timestamp: string, item: Record<string, unknown>) => ({
    timestamp,
    type: 'event_msg',
    payload: { type: 'item_completed', thread_id: 'desktop-thread', turn_id: 'turn-1', item },
  });

  it('uses the first real user request as summary, skipping injected context messages', async () => {
    const home = makeCodexHome();
    writeRollout(home, path.join('sessions', '2026', '09', '28'), 'rollout-2026-09-28T10-00-00-desktop-thread.jsonl', [
      desktopMeta('desktop-thread'),
      userItem(
        '2026-09-28T10:00:01.000Z',
        '# AGENTS.md instructions for /tmp/desktop-project\n\n<INSTRUCTIONS>x</INSTRUCTIONS>',
      ),
      userItem(
        '2026-09-28T10:00:01.100Z',
        '<environment_context>\n  <cwd>/tmp/desktop-project</cwd>\n</environment_context>',
      ),
      userItem('2026-09-28T10:00:01.200Z', '<in-app-browser-context>tabs</in-app-browser-context>'),
      userItem('2026-09-28T10:00:02.000Z', '씬 트리에 다중 선택을 추가해줘'),
      assistantItem('2026-09-28T10:00:03.000Z', '다중 선택을 추가하겠습니다.'),
    ]);

    const { parseCodexSessions, extractCodexContext } = await loadCodexParser(home);
    const [session] = await parseCodexSessions();
    const context = await extractCodexContext(session);

    expect(session.summary).toBe('씬 트리에 다중 선택을 추가해줘');
    expect(context.recentMessages.map((m) => m.content)).toEqual([
      '씬 트리에 다중 선택을 추가해줘',
      '다중 선택을 추가하겠습니다.',
    ]);
  });

  it('skips guardian_review subagent sessions (auto-approval reviewers are not user work)', async () => {
    const home = makeCodexHome();
    const dir = path.join('sessions', '2026', '09', '28');
    writeRollout(home, dir, 'rollout-2026-09-28T10-00-00-user-thread.jsonl', [
      desktopMeta('user-thread'),
      userItem('2026-09-28T10:00:02.000Z', 'real work'),
    ]);
    writeRollout(home, dir, 'rollout-2026-09-28T10-05-00-guardian-thread.jsonl', [
      desktopMeta('guardian-thread', {
        source: { subagent: { other: 'guardian' } },
        thread_source: 'guardian_review',
        parent_thread_id: 'user-thread',
      }),
      userItem(
        '2026-09-28T10:05:01.000Z',
        'The following is the Codex agent history whose request action you are assessing.',
      ),
    ]);

    const { parseCodexSessions } = await loadCodexParser(home);
    const sessions = await parseCodexSessions();

    expect(sessions.map((s) => s.id)).toEqual(['user-thread']);
  });

  it('collapses rollout segments of one thread into a single session keyed by the thread id', async () => {
    const home = makeCodexHome();
    const dir = path.join('sessions', '2026', '09', '28');
    writeRollout(home, dir, 'rollout-2026-09-28T09-00-00-seg-thread.jsonl', [
      { ...desktopMeta('seg-thread'), timestamp: '2026-09-28T09:00:00.000Z' },
      userItem('2026-09-28T09:00:01.000Z', 'first segment request'),
    ]);
    const latest = writeRollout(home, dir, 'rollout-2026-09-28T10-00-00-seg-thread_seg-two.jsonl', [
      { ...desktopMeta('seg-thread'), ordinal: 4089 },
      userItem('2026-09-28T10:00:01.000Z', 'second segment request'),
    ]);

    const { parseCodexSessions } = await loadCodexParser(home);
    const sessions = await parseCodexSessions();

    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe('seg-thread');
    expect(sessions[0].originalPath).toBe(latest);
    expect(sessions[0].summary).toBe('second segment request');
  });

  it('reads commands and file changes from item_completed instead of the exec JS wrapper', async () => {
    const home = makeCodexHome();
    writeRollout(home, path.join('sessions', '2026', '09', '28'), 'rollout-2026-09-28T10-00-00-tools-thread.jsonl', [
      desktopMeta('tools-thread'),
      userItem('2026-09-28T10:00:01.000Z', '테스트 고쳐줘'),
      {
        timestamp: '2026-09-28T10:00:02.000Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          status: 'completed',
          call_id: 'call_1',
          name: 'exec',
          input:
            'const r = await tools.exec_command({cmd: "npm test", workdir: "/tmp/desktop-project"});\ntext(r.output);',
        },
      },
      {
        timestamp: '2026-09-28T10:00:03.000Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call_output',
          call_id: 'call_1',
          output: [{ type: 'input_text', text: 'Script completed\nOutput:\n1 failed' }],
        },
      },
      completed('2026-09-28T10:00:03.000Z', {
        type: 'CommandExecution',
        id: 'exec-1',
        command: ['/bin/bash', '-lc', 'npm test'],
        cwd: 'file:///tmp/desktop-project',
        parsed_cmd: [{ type: 'unknown', cmd: 'npm test' }],
        source: 'unified_exec_startup',
        status: 'failed',
        stdout: '1 failed',
        stderr: '',
        aggregated_output: '1 failed',
        exit_code: 1,
      }),
      completed('2026-09-28T10:00:04.000Z', {
        type: 'FileChange',
        id: 'exec-2',
        status: 'completed',
        changes: {
          '/tmp/desktop-project/src/app.ts': {
            type: 'update',
            unified_diff: '@@ -1,2 +1,2 @@\n-const a = 1;\n+const a = 2;\n keep();\n',
            move_path: null,
          },
          '/tmp/desktop-project/src/new.ts': { type: 'add', content: 'export const b = 1;\n' },
        },
      }),
      completed('2026-09-28T10:00:05.000Z', {
        type: 'McpToolCall',
        id: 'exec-3',
        server: 'codex_app',
        tool: 'read_thread',
        arguments: { threadId: 'x' },
        status: 'completed',
        result: { content: [{ type: 'text', text: 'thread body' }] },
      }),
      completed('2026-09-28T10:00:06.000Z', {
        type: 'Extension',
        kind: 'web.search',
        id: 'exec-4',
        query: 'mujoco convex hull',
        action: { type: 'search', query: null, queries: ['mujoco convex hull'] },
        results: [],
      }),
      {
        timestamp: '2026-09-28T10:00:07.000Z',
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'wait',
          arguments: '{"cell_id":"1","yield_time_ms":30000}',
          call_id: 'call_2',
        },
      },
      assistantItem('2026-09-28T10:00:08.000Z', '고쳤습니다.'),
    ]);

    const { parseCodexSessions, extractCodexContext } = await loadCodexParser(home);
    const [session] = await parseCodexSessions();
    const context = await extractCodexContext(session);

    expect(context.filesModified.sort()).toEqual([
      '/tmp/desktop-project/src/app.ts',
      '/tmp/desktop-project/src/new.ts',
    ]);

    const byName = Object.fromEntries(context.toolSummaries.map((s) => [s.name, s]));
    // the JS wrapper and the cell-polling helper are plumbing, not user-visible activity
    expect(byName.exec).toBeUndefined();
    expect(byName.wait).toBeUndefined();

    const shell = context.toolSummaries.find((s) => s.samples.some((x) => x.summary.includes('$ npm test')));
    expect(shell).toBeDefined();
    expect(shell?.errorCount).toBe(1);

    const allSamples = context.toolSummaries.flatMap((s) => s.samples.map((x) => x.summary)).join('\n');
    expect(allSamples).toContain('src/app.ts');
    expect(allSamples).toContain('src/new.ts');
    expect(allSamples).toContain('codex_app');
    expect(allSamples).toContain('mujoco convex hull');
    expect(context.markdown).toContain('## Files Modified');
  });
});
