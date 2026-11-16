import {test,expect} from 'bun:test';import {parseScoringQualityArgs,scoringQualityMain} from '../scripts/scoring-quality.ts';
test('scoring quality CLI defaults offline and requires explicit same-batch authorization and execute flag',async()=>{
 expect(parseScoringQualityArgs([])).toEqual({command:'prepare'});expect(parseScoringQualityArgs(['demo'])).toEqual({command:'demo'});
 expect(parseScoringQualityArgs(['prepare','--suite','contrast'])).toEqual({command:'prepare',suite:'contrast'});expect(parseScoringQualityArgs(['demo','--suite','contrast'])).toEqual({command:'demo',suite:'contrast'});
 expect(parseScoringQualityArgs(['demo','--suite','challenge'])).toEqual({command:'demo',suite:'challenge'});
 expect(parseScoringQualityArgs(['compare','a','b']).command).toBe('compare');
 expect(()=>parseScoringQualityArgs(['prepare','--suite','reserved-final'])).toThrow('SCORING_QUALITY_ARGS_INVALID');
 for(const args of [['execute'],['execute','batch','--execute'],['demo','--execute'],['inspect','batch','--execute'],['execute','batch','--authorization','a','--execute','--retry']])expect(()=>parseScoringQualityArgs(args)).toThrow('SCORING_QUALITY_ARGS_INVALID');
 let reads=0;await expect(scoringQualityMain(['execute','batch','--authorization','other/authorization.json','--execute'],{environment:()=>{reads++;return 'no';}})).rejects.toThrow('SCORING_QUALITY_AUTHORIZATION_PATH');expect(reads).toBe(0);
});
