import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadKnowledgeWorkspace } from '../apps/agent/src/knowledge/catalog.ts';
import { buildKnowledgeCatalog } from '../apps/agent/src/knowledge/curation.ts';

/** Export a review packet. This command never writes approvals or edits authoring files. */
export async function exportKnowledgeReviewPacket() {
  const w = loadKnowledgeWorkspace(), catalog = buildKnowledgeCatalog(w, { mode: 'draft-preview' });
  const packet = { version: 1, generatedAt: new Date(w.now).toISOString(), authority: catalog.authority,
    productionPublished: false, summary: catalog.summary, entries: catalog.entries.map(e => ({ ...e,
      item: w.items.find(i => i.id === e.itemId)!, dossier: w.dossiers.find(d => d.itemId === e.itemId)!,
      sources: w.sources.filter(s => w.items.find(i => i.id === e.itemId)!.sourceIds.includes(s.id)) })) };
  const root = join(process.cwd(), '.cache/knowledge-review');
  await mkdir(root, { recursive: true });
  const output = await mkdtemp(join(root, 'run-'));
  await writeFile(join(output, 'packet.json'), JSON.stringify(packet, null, 2) + '\n');
  const lines = ['# 岗位知识审核包', '', `生成：${packet.generatedAt}；${catalog.summary.total}条；可送人工审核${catalog.summary.readyForHumanReview}条；当前reviewed ${catalog.summary.reviewed}条。`, '',
    '文件声明不等于身份认证；未自动批准或发布。请对照packet.json逐题检查指南、追问、量规、适用版本与来源。', '',
    '| 条目 | 岗位 | 状态 | 待处理 |', '| --- | --- | --- | --- |',
    ...catalog.entries.map(e => `| ${e.itemId} | ${e.roleId} | ${e.reviewStatus} | ${e.issues.join(', ')} |`), ''];
  await writeFile(join(output, 'review.md'), lines.join('\n'));
  return { output, ...catalog.summary, authority: catalog.authority, productionPublished: false };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 2) throw new Error('KNOWLEDGE_REVIEW_USAGE');
    console.log(JSON.stringify(await exportKnowledgeReviewPacket()));
  } catch { console.error('KNOWLEDGE_REVIEW_FAILED'); process.exitCode = 1; }
}
