import type { EvidenceSupportRejection } from '../../../packages/interview-domain/src/evidence-support.ts';
export interface SupportCase {
 id: string;
 group: 'admission'|'positive-control'|'multiple-citations'|'dimension-boundary'|'english-boundary'|'semantic-challenge';
 lane: 'regression'|'known-limit';
 dimension?: 'verification'|'ownership'|'correctness';
 quotes: string[];
 expected: EvidenceSupportRejection|null;
 limitation?: string;
}
// All examples and policy expectations are assistant-authored synthetic development data.
// null means no known rejection, never an independently supported grade.
export const supportCases: SupportCase[] = [
 {id:'admission-zh',group:'admission',lane:'regression',quotes:['我不清楚。'],expected:'no-substantive-answer'},
 {id:'admission-english',group:'admission',lane:'regression',quotes:["I don't know."],expected:'no-substantive-answer'},
 {id:'admission-polite-zh',group:'admission',lane:'regression',quotes:['抱歉，这个问题我暂时不清楚。'],expected:'no-substantive-answer'},
 {id:'admission-polite-en',group:'admission',lane:'regression',quotes:["Sorry, I don't know."],expected:'no-substantive-answer'},
 {id:'admission-uncertain-en',group:'admission',lane:'regression',quotes:["I'm not sure how to answer this."],expected:'no-substantive-answer'},
 {id:'admission-typographic',group:'admission',lane:'regression',quotes:['Ｉ　ｄｏ　ｎｏｔ　ｋｎｏｗ．'],expected:'no-substantive-answer'},
 {id:'control-negative',group:'positive-control',lane:'regression',quotes:['不会。'],expected:null},
 {id:'control-symbol',group:'positive-control',lane:'regression',quotes:['-'],expected:null},
 {id:'control-substantive-uncertainty',group:'positive-control',lane:'regression',quotes:['我不清楚具体实现，但旧请求可以用递增序号隔离。'],expected:null},
 {id:'control-english-substantive',group:'positive-control',lane:'regression',quotes:["I don't know the implementation, but cancellation alone cannot undo a committed write."],expected:null},
 {id:'control-wrong-technical',group:'positive-control',lane:'regression',dimension:'correctness',quotes:['volatile可以让任意复合运算都具有原子性。'],expected:null},
 {id:'control-wrong-verification',group:'positive-control',lane:'regression',dimension:'verification',quotes:['没有错误日志就能证明所有竞争条件都不存在。'],expected:null},
 {id:'control-hypothetical-check',group:'positive-control',lane:'regression',dimension:'verification',quotes:['假设网络超时，我会检查重试入口是否可见。'],expected:null},
 {id:'control-hypothetical-owner',group:'positive-control',lane:'regression',dimension:'ownership',quotes:['假设我负责这一部分，应该先隔离旧响应再增加日志。'],expected:null},
 {id:'control-stated-owner',group:'positive-control',lane:'regression',dimension:'ownership',quotes:['我负责实现请求编号，并增加日志定位旧响应。'],expected:null},
 {id:'multi-all-admissions',group:'multiple-citations',lane:'regression',quotes:['不知道。',"I don't know."],expected:'no-substantive-answer'},
 {id:'multi-admission-check',group:'multiple-citations',lane:'regression',dimension:'verification',quotes:['不知道。','建议记录请求编号。','注入超时并检查页面是否提示重试。'],expected:null},
 {id:'multi-all-risk',group:'multiple-citations',lane:'regression',dimension:'verification',quotes:['容易出现重复提交。','建议增加日志。'],expected:'risk-only-verification'},
 {id:'multi-admission-risk',group:'multiple-citations',lane:'regression',dimension:'verification',quotes:['不知道。','应该记录错误日志。'],expected:'risk-only-verification'},
 {id:'multi-owner-advice',group:'multiple-citations',lane:'regression',dimension:'ownership',quotes:['建议增加日志。','我实现了请求序号隔离。'],expected:null},
 {id:'dimension-verification',group:'dimension-boundary',lane:'regression',dimension:'verification',quotes:['建议上报日志。'],expected:'risk-only-verification'},
 {id:'dimension-owner',group:'dimension-boundary',lane:'regression',dimension:'ownership',quotes:['建议上报日志。'],expected:'advice-only-ownership'},
 {id:'dimension-correctness',group:'dimension-boundary',lane:'regression',dimension:'correctness',quotes:['建议上报日志。'],expected:null},
 {id:'dimension-absent',group:'dimension-boundary',lane:'regression',quotes:['建议上报日志。'],expected:null},
 {id:'en-latest-not-test',group:'english-boundary',lane:'regression',dimension:'verification',quotes:['We should use the latest retry policy.'],expected:'risk-only-verification'},
 {id:'en-tested',group:'english-boundary',lane:'regression',dimension:'verification',quotes:['We tested the logging fallback under timeout.'],expected:null},
 {id:'en-brisk-not-risk',group:'english-boundary',lane:'regression',dimension:'verification',quotes:['The retry screen has a brisk animation.'],expected:null},
 {id:'en-stated-owner',group:'english-boundary',lane:'regression',dimension:'ownership',quotes:['I implemented the logging fallback.'],expected:null},
 {id:'gap-keyword-denial',group:'semantic-challenge',lane:'known-limit',dimension:'verification',quotes:['建议补测试，但我没有验证过。'],expected:null,limitation:'Negated verification words are not interpreted; unverified is not proof of a completed check.'},
 {id:'gap-unrelated-check',group:'semantic-challenge',lane:'known-limit',dimension:'verification',quotes:['容易重复提交。','检查过按钮颜色。'],expected:null,limitation:'Checks mentioned in another citation need not validate the scored technical property.'},
 {id:'gap-third-party-owner',group:'semantic-challenge',lane:'known-limit',dimension:'ownership',quotes:['我负责日志，但事务幂等是同事实现的。'],expected:null,limitation:'Self action does not establish ownership of every technical claim.'},
 {id:'gap-incomplete-procedure',group:'semantic-challenge',lane:'known-limit',dimension:'verification',quotes:['建议测试一下。'],expected:null,limitation:'A test keyword alone does not establish an executable or sufficient verification procedure.'},
 {id:'gap-oblique-admission',group:'semantic-challenge',lane:'known-limit',quotes:['这个点先跳过，换一个吧。'],expected:null,limitation:'Indirect non-answers outside the explicit phrase set still require semantic assessment.'},
];
