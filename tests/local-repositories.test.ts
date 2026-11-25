import type { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';

import { upgradeProfileV3ToV4 } from '../packages/local-db/src/profile/upgrade.ts';
import {
  LocalRepositoryError,
  createExperimentRepository,
  createHintRepository,
  createLearningRepository,
} from '../packages/local-db/src/repositories/index.ts';
import type {
  ExperimentRecordShape,
  ExperimentRepository,
  HintBinding,
  HintEntry,
  HintJournal,
  HintRepository,
  LearningRecordShape,
  LearningRepository,
} from '../packages/local-db/src/repositories/index.ts';
import {
  V3_FENCE,
  V3_NOW,
  V3_OWNER,
  V3_PROFILE_ID,
  V3_SESSION_ID,
  createV3ProfileDb,
} from './fixtures/profile-v3.ts';

const tempDirs: string[] = [];
function upgradedDb(): Database {
  const dir = mkdtempSync(join(tmpdir(), 'local-repositories-'));
  tempDirs.push(dir);
  const db = createV3ProfileDb();
  db.transaction(() => upgradeProfileV3ToV4(db, {
    profileDir: dir,
    profileId: V3_PROFILE_ID,
    owner: V3_OWNER,
    fence: V3_FENCE,
    now: V3_NOW,
    backup: false,
  })).immediate();
  return db;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function expectRepoCode(fn: () => unknown, code: LocalRepositoryError['code']): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(LocalRepositoryError);
    expect((error as LocalRepositoryError).code).toBe(code);
    return;
  }
  throw new Error(`Expected LocalRepositoryError ${code}`);
}

function saveHint(db: Database, repo: HintRepository, next: HintJournal, expected: number | null): void {
  db.transaction(() => repo.save(db, next, expected)).immediate();
}
function saveLearning<T extends LearningRecordShape>(
  db: Database,
  repo: LearningRepository<T>,
  userId: string,
  next: T,
  expected: number | null,
): void {
  db.transaction(() => repo.save(db, userId, next, expected)).immediate();
}
function saveExperiment<T extends ExperimentRecordShape>(
  db: Database,
  repo: ExperimentRepository<T>,
  userId: string,
  next: T,
  expected: number | null,
): void {
  db.transaction(() => repo.save(db, userId, next, expected)).immediate();
}

function binding(issueId = '1'.repeat(64)): HintBinding {
  return {
    userId: V3_PROFILE_ID,
    roleId: 'java-backend',
    sessionId: V3_SESSION_ID,
    issueId,
    questionId: 'question-1',
    issuedAt: 1_000,
  };
}

function journal(target: HintBinding, version: number, entries: HintEntry[]): HintJournal {
  return { schemaVersion: 1, binding: target, limit: 2, version, entries };
}

type TestLearning = LearningRecordShape & {
  progress: { version: number };
  prediction: Record<string, unknown>;
  retestPair: null;
};

type TestExperimentRun = {
  jobId: string;
  operationId: string;
  action: string;
  sourceSessionId: string | null;
  status: string;
  outcome: string | null;
  errorCode: string | null;
  createdAt: number;
  finishedAt: number | null;
};

type TestExperiment = Omit<ExperimentRecordShape, 'runs'> & {
  registry: Record<string, unknown>;
  runs: readonly TestExperimentRun[];
};

function learningRecord(assignmentId: string, version: number, operations: TestLearning['operations']): TestLearning {
  return {
    assignmentId,
    roleId: 'java-backend',
    version,
    progress: { version },
    prediction: {},
    retestPair: null,
    operations,
  };
}

function experimentRecord(
  experimentId: string,
  version: number,
  runs: TestExperiment['runs'],
  operations: TestExperiment['operations'],
): TestExperiment {
  return {
    experimentId,
    roleId: 'java-backend',
    version,
    registry: { version: 1, activePolicyId: 'baseline-v0', initialPolicyId: 'baseline-v0' },
    runs,
    operations,
  };
}

describe('formal local hint repository', () => {
  test('persists reserve/commit history, pending recovery and profile-wide operations', () => {
    const db = upgradedDb();
    const repo = createHintRepository({ now: () => 2_000 });
    const first = binding();

    saveHint(db, repo, journal(first, 0, []), null);
    const reserved1 = journal(first, 1, [{
      operationId: 'hint-op-1',
      level: 1,
      reservedAt: 1_000,
      updatedAt: 1_000,
      status: 'reserved',
    } satisfies HintEntry]);
    saveHint(db, repo, reserved1, 0);
    expect(repo.load(db, first)).toEqual(reserved1);
    expect(repo.pending(db, V3_PROFILE_ID)).toEqual([reserved1]);
    expect(repo.findOperation(db, V3_PROFILE_ID, 'hint-op-1')).toEqual(first);

    const committed1 = journal(first, 2, [{
      operationId: 'hint-op-1',
      level: 1,
      reservedAt: 1_000,
      updatedAt: 1_100,
      status: 'committed',
      text: '先说明事务边界。',
      hintVersion: 'coaching-v1',
    } satisfies HintEntry]);
    saveHint(db, repo, committed1, 1);
    expect(repo.pending(db, V3_PROFILE_ID)).toEqual([]);

    const reserved2 = journal(first, 3, [
      ...committed1.entries,
      {
        operationId: 'hint-op-2',
        level: 2,
        reservedAt: 1_200,
        updatedAt: 1_200,
        status: 'reserved',
      } satisfies HintEntry,
    ]);
    saveHint(db, repo, reserved2, 2);
    const committed2 = journal(first, 4, [
      ...committed1.entries,
      {
        operationId: 'hint-op-2',
        level: 2,
        reservedAt: 1_200,
        updatedAt: 1_300,
        status: 'committed',
        text: '再给出失败恢复步骤。',
        hintVersion: 'coaching-v1',
      } satisfies HintEntry,
    ]);
    saveHint(db, repo, committed2, 3);
    expect(repo.load(db, first)).toEqual(committed2);
    expect(repo.findOperation(db, V3_PROFILE_ID, 'hint-op-2')).toEqual(first);

    expectRepoCode(() => saveHint(db, repo, committed2, 3), 'VERSION_CONFLICT');
    expectRepoCode(() => saveHint(db, repo, journal(first, 5, [
      ...committed2.entries,
      {
        operationId: 'hint-op-3',
        level: 1,
        reservedAt: 1_400,
        updatedAt: 1_400,
        status: 'reserved',
      } satisfies HintEntry,
    ]), 4), 'VALIDATION_ERROR');

    const otherIssue = binding('2'.repeat(64));
    expectRepoCode(() => saveHint(db, repo, journal(otherIssue, 1, [{
      operationId: 'hint-op-1',
      level: 1,
      reservedAt: 1_000,
      updatedAt: 1_000,
      status: 'reserved',
    } satisfies HintEntry]), null), 'VERSION_CONFLICT');

    const otherProfile = { ...first, userId: 'another-profile' };
    expect(() => saveHint(db, repo, journal(otherProfile, 0, []), null)).toThrow();
    expectRepoCode(() => repo.save(db, journal(first, 4, committed2.entries), 3), 'TRANSACTION_REQUIRED');
  });

  test('fails closed above 4000 pending journals', () => {
    const db = upgradedDb();
    const repo = createHintRepository();
    const insert = db.query(`
      INSERT INTO local_hint_journals
        (user_id, issue_id, role_id, session_id, question_id, issued_at, journal_limit,
         version, committed_count, reserved_count, body, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 2, 1, 0, 1, ?, ?)
    `);
    for (let index = 0; index <= 4_000; index++) {
      const issueId = index.toString(16).padStart(64, '0');
      const target = binding(issueId);
      const body = journal(target, 1, [{
        operationId: `pending-op-${index}`,
        level: 1,
        reservedAt: 1_000,
        updatedAt: 1_000,
        status: 'reserved',
      } satisfies HintEntry]);
      insert.run(
        V3_PROFILE_ID,
        issueId,
        'java-backend',
        V3_SESSION_ID,
        'question-1',
        1_000,
        JSON.stringify(body),
        1_000,
      );
    }
    expectRepoCode(() => repo.pending(db, V3_PROFILE_ID), 'PENDING_LIMIT_EXCEEDED');
  });
});

describe('formal local learning repository', () => {
  test('CAS, operation replay and role-filtered listing', () => {
    const db = upgradedDb();
    const repo = createLearningRepository<TestLearning>({ now: () => 3_000 });
    const op1 = {
      operationId: 'learning-op-1',
      kind: 'assignment_create',
      digest: 'a'.repeat(64),
      processedAt: 1_000,
      result: { assignmentId: 'assignment-1' },
    };
    const first = learningRecord('assignment-1', 0, [op1]);
    saveLearning(db, repo, V3_PROFILE_ID, first, null);
    expect(repo.load(db, V3_PROFILE_ID, 'assignment-1')).toEqual(first);
    expect(repo.list(db, V3_PROFILE_ID)).toEqual([first]);
    expect(repo.list(db, V3_PROFILE_ID, 'java-backend')).toEqual([first]);
    expect(repo.list(db, V3_PROFILE_ID, 'web-frontend')).toEqual([]);
    expect(repo.findOperation(db, V3_PROFILE_ID, 'learning-op-1')).toEqual(first);

    const op2 = {
      operationId: 'learning-op-2',
      kind: 'event_record',
      digest: 'b'.repeat(64),
      processedAt: 1_100,
      result: { accepted: true },
    };
    const second = learningRecord('assignment-1', 1, [op1, op2]);
    saveLearning(db, repo, V3_PROFILE_ID, second, 0);
    expect(repo.load(db, V3_PROFILE_ID, 'assignment-1')).toEqual(second);

    expectRepoCode(() => saveLearning(db, repo, V3_PROFILE_ID, second, 0), 'VERSION_CONFLICT');
    expectRepoCode(() => saveLearning(db, repo, V3_PROFILE_ID, learningRecord('assignment-1', 2, [
      op1,
      { ...op2, digest: 'c'.repeat(64) },
    ]), 1), 'VERSION_CONFLICT');
    expectRepoCode(() => saveLearning(db, repo, V3_PROFILE_ID, learningRecord('assignment-2', 0, [op1]), null), 'VERSION_CONFLICT');
    expectRepoCode(() => saveLearning(db, repo, V3_PROFILE_ID, learningRecord('assignment-1', 2, [
      op1,
      op2,
      { ...op2, digest: 'd'.repeat(64) },
    ]), 1), 'VALIDATION_ERROR');
    expectRepoCode(() => repo.save(db, V3_PROFILE_ID, second, 1), 'TRANSACTION_REQUIRED');
  });

  test('rolls back record and ledger with the host transaction', () => {
    const db = upgradedDb();
    const repo = createLearningRepository<TestLearning>();
    const record = learningRecord('assignment-rollback', 0, [{
      operationId: 'learning-rollback-op',
      kind: 'assignment_create',
      digest: 'e'.repeat(64),
      processedAt: 1_000,
      result: {},
    }]);
    expect(() => db.transaction(() => {
      repo.save(db, V3_PROFILE_ID, record, null);
      throw new Error('host rollback');
    }).immediate()).toThrow('host rollback');
    expect(repo.load(db, V3_PROFILE_ID, 'assignment-rollback')).toBeNull();
    expect(repo.findOperation(db, V3_PROFILE_ID, 'learning-rollback-op')).toBeNull();
  });

  test('shares operationId uniqueness with hints across modules', () => {
    const db = upgradedDb();
    const learning = createLearningRepository<TestLearning>();
    saveLearning(db, learning, V3_PROFILE_ID, learningRecord('assignment-shared', 0, [{
      operationId: 'shared-operation',
      kind: 'assignment_create',
      digest: 'f'.repeat(64),
      processedAt: 1_000,
      result: {},
    }]), null);
    const hints = createHintRepository();
    expectRepoCode(() => saveHint(db, hints, journal(binding('3'.repeat(64)), 1, [{
      operationId: 'shared-operation',
      level: 1,
      reservedAt: 1_000,
      updatedAt: 1_000,
      status: 'reserved',
    } satisfies HintEntry]), null), 'VERSION_CONFLICT');
  });
});

describe('formal local experiment repository', () => {
  test('CAS, pending recovery and interrupted startup transition', () => {
    const db = upgradedDb();
    const repo = createExperimentRepository<TestExperiment>({ now: () => 4_000 });
    const evaluateOp = {
      operationId: 'experiment-op-1',
      action: 'evaluate',
      digest: '9'.repeat(64),
      processedAt: 1_000,
      result: { status: 'evaluated_activated_offline' },
    };
    const run = {
      jobId: 'experiment-job-1',
      operationId: 'experiment-op-1',
      action: 'evaluate',
      sourceSessionId: V3_SESSION_ID,
      status: 'queued',
      outcome: null,
      errorCode: null,
      createdAt: 1_000,
      finishedAt: null,
    };
    const first = experimentRecord('experiment-1', 0, [run], [evaluateOp]);
    saveExperiment(db, repo, V3_PROFILE_ID, first, null);
    expect(repo.load(db, V3_PROFILE_ID, 'experiment-1')).toEqual(first);
    expect(repo.list(db, V3_PROFILE_ID, 'java-backend')).toEqual([first]);
    expect(repo.pending(db, V3_PROFILE_ID)).toEqual([first]);
    expect(repo.findOperation(db, V3_PROFILE_ID, 'experiment-op-1')).toEqual(first);

    const interrupted = experimentRecord('experiment-1', 1, [{
      ...run,
      status: 'interrupted',
      errorCode: 'INTERRUPTED',
      finishedAt: 2_000,
    }], [evaluateOp]);
    saveExperiment(db, repo, V3_PROFILE_ID, interrupted, 0);
    expect(repo.pending(db, V3_PROFILE_ID)).toEqual([]);
    expect(repo.load(db, V3_PROFILE_ID, 'experiment-1')).toEqual(interrupted);
    expectRepoCode(() => saveExperiment(db, repo, V3_PROFILE_ID, interrupted, 0), 'VERSION_CONFLICT');
    expectRepoCode(() => saveExperiment(db, repo, V3_PROFILE_ID, experimentRecord('experiment-2', 0, [], [evaluateOp]), null), 'VERSION_CONFLICT');
    expectRepoCode(() => repo.save(db, V3_PROFILE_ID, interrupted, 1), 'TRANSACTION_REQUIRED');
  });
});
