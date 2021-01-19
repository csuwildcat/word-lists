
const yargs = require('yargs/yargs')
const { hideBin } = require('yargs/helpers')
const argv = yargs(hideBin(process.argv)).argv;

const fs = require('fs-extra');
const fetch = require('node-fetch');
const gulp = require('gulp');
const run = require('gulp-run');
const bump = require('gulp-bump');
const concat = require('gulp-concat');
const terser = require('gulp-terser');
const mergeStreams = require('merge-stream');


const natural = require('natural');
const language = "EN"
const defaultCategory = 'N';
const defaultCategoryCapitalized = 'NNP';

var lexicon = new natural.Lexicon(language, defaultCategory, defaultCategoryCapitalized);
var ruleSet = new natural.RuleSet(language);
var partsOfSpeech = new natural.BrillPOSTagger(lexicon, ruleSet);


let compileLocation = 'data/output';
let blockedWords = require('./data/blocked.json');
const wordFiles = [
  'data/modified/subtlex.txt', // manually vet
  'data/modified/bip-39.txt', // add to compile group
  'data/modified/eff.txt', // add to compile group
  'data/modified/plants.txt', // filter by length, add after for dupe only
  'data/modified/animals.txt', // filter by length, add after for dupe only
  // 'data/modified/verbs.txt',
  //'data/modified/google-books.txt',
];

const minLength = argv.min || 3;
const maxLength = argv.max || 8;

const sortMap = {
  'true': (a, b) => a.token.length - b.token.length || a.token.localeCompare(b.token),
  'asc': (a, b) => a.token.length - b.token.length,
  'desc': (a, b) => b.token.length - a.token.length,
  'lex': (a, b) => a.token.localeCompare(b.token)
}

const posFilterMap = {
  plural: 'NNS,VBZ',
  past: 'VBD',
  present: 'VBG',
  default: 'CC,DT,EX,IN,FW,MD,RB,VBN,VBP,JJR,JJS,PRP,UH,WP,WDT,WRB,PRP$,WP$'
};

posFilterMap.strict = Object.values(posFilterMap).join(',');
posFilterMap.pos = argv.pos;

var posFilter = [];
for (let z in posFilterMap) {
  if (argv[z]) posFilter.push(posFilterMap[z])
}
posFilter = posFilter.join(',').split(/\s*,\s*/g).reduce((obj, pos) => { obj[pos] = true; return obj }, {});

const stripRepeated = /((\w+)(\w))\3$|/i;
const suffixMap = {
  actor: ['er'],
  past: ['ed'],
  present: ['ing'],
  like: ['ity','ish','y'],
  without: ['less'],
  abstract: ['ism','tism','tist']
}
const getPosWords = words => partsOfSpeech.tag(words).taggedWords;
const getTokenRegex = () => new RegExp(`\\b([a-zA-Z]{${minLength},${maxLength}})(?::|,|\\r|\\n|\\s+)`, 'gmi');

async function parseFiles(files, union){
  let words = {};
  let regex = getTokenRegex();
  let paths = Array.isArray(files) ? files : [files];
  let occurrences = {};
  await Promise.all(
    paths.map(path => fs.readFile(path, 'utf8'))
  ).then(texts => {
    texts.forEach((text, i) => {
      let dupeMap = {};
      text.replace(regex, (m, g1) => {
        let word = g1.toLowerCase();
        words[word] = true;
        if (!dupeMap[word]) {
          dupeMap[word] = true;
          occurrences[word] = occurrences[word] || 0;
          occurrences[word]++;
        }
      });
    });
  })
  if (union) {
    let overlap = {};
    for (let word in occurrences) {
      overlap[occurrences[word]] = overlap[occurrences[word]] || 0;
      overlap[occurrences[word]]++;
    }
    return overlap;
  }
  else return words;
}

function compileWords(){
  return new Promise(async resolve => {
    await fs.ensureDir(compileLocation);
    let files = argv.files ? argv.files.split(/\s*,\s*/g) : wordFiles;
    let wordMap = await parseFiles(files);
    let words = getPosWords(Object.keys(wordMap));
    let filterSimilar = argv.similar === true ? maxLength - 3 : argv.similar;
    if (argv.sort) words.sort(sortMap[argv.sort]);
    let suffixes;
    if (argv.strict) {
      suffixes = Object.values(suffixMap).flat().sort((a, b) => b.length - a.length);
    }
    else {
      suffixes = [];
      for (let z in suffixMap) {
        if (argv[z]) endings.push(suffixMap[z])
      }
      suffixes = suffixes.flat().sort((a, b) => b.length - a.length);
    }
    words = words.reduce((entries, entry) => {
      let word = entry.token;
      if (blockedWords[word]) return entries;
      if (posFilter[entry.tag]) return entries;
      if (filterSimilar && word.length > filterSimilar){ 
        if (wordMap[word.slice(0, filterSimilar)]) return entries;
      }
      if (suffixes.some(suffix => {
        let length = -suffix.length;
        let slice = word.slice(length);
        if (slice === suffix) {
          let root = word.slice(0, length);
          root = stripRepeated.exec(root)[1] || root;
          return wordMap[root] || wordMap[root + 'e'];
        }
      })) return entries;
      entries[word] = entry.tag;
      return entries;
    }, {});
    let filename = (compileLocation + '/' + (argv.filename || files.map(path => {
      return path.split('/').pop().split('.')[0];
    }).join('-'))) + (argv.list ? '.txt' : '.json');
    await fs.writeFile(filename, argv.list ? Object.keys(words).join('\n') : JSON.stringify(words, null, 2));
    resolve();
  });
}

function getUnions() {
  return new Promise(async resolve => {
    await fs.ensureDir(compileLocation);
    let files = argv.files ? argv.files.split(/\s*,\s*/g) : wordFiles;
    let overlap = await parseFiles(files, true);
    console.log(overlap);
    resolve();
  });
}

gulp.task('overlap', getUnions);
gulp.task('compile', compileWords);