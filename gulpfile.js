
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

const textGrader = require('text-readability');

const natural = require('natural');
const language = 'EN'
const defaultCategory = 'N';
const defaultCategoryCapitalized = 'NNP';
const lexicon = new natural.Lexicon(language, defaultCategory, defaultCategoryCapitalized);
const partsOfSpeech = new natural.BrillPOSTagger(lexicon, new natural.RuleSet(language));


let compileLocation = 'data/output';
let blockedWords = require('./data/blocked.json');
const wordFiles = [
  'data/final/subtlex.txt', // manually vet
  'data/final/bip-39.txt', // add to compile group
  //'data/final/eff.txt', // add to compile group
  'data/final/fruits.txt', // filter by length, add after for dupe only
  'data/final/plants.txt', // filter by length, add after for dupe only
  'data/final/animals.txt', // filter by length, add after for dupe only
  'data/final/random.txt', // filter by length, add after for dupe only
  'data/final/verbs.txt', // filter by length, add after for dupe only
];

console.log(argv.max === 'false');

const minLength = argv.min === 0 ? 0 : argv.min || 3;
const maxLength = argv.max === 'false' ? 20 : argv.max || 10;

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
  default: 'CC,DT,EX,IN,FW,MD,RB,VBN,VBP,JJR,JJS,PRP,RBS,UH,WP,WDT,WRB,PRP$,WP$'
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
  plural: ['s'],
  past: ['ed', 'en'],
  present: ['ing'],
  like: ['ive','ity','ish','y'],
  with: ['ful'],
  without: ['less'],
  abstract: ['ism','tism','tist']
}

function getSuffixes(strict){
  if (strict) {
    return Object.values(suffixMap).flat().sort((a, b) => b.length - a.length);
  }
  else {
    let suffixes = [];
    for (let z in suffixMap) {
      if (argv[z]) suffixes.push(suffixMap[z])
    }
    return suffixes.flat().sort((a, b) => b.length - a.length);
  }
}

const getPosWords = words => words.map(word => partsOfSpeech.tag([word]).taggedWords[0]);
const getTokenRegex = () => new RegExp(`\\b([a-zA-Z]{${minLength},${maxLength}})(?::|,|\\r|\\n|\\s+)`, 'gmi');

async function getFiles(){
  await fs.ensureDir(compileLocation);
  return argv.files ? argv.files.split(/\s*,\s*/g) : wordFiles;
}

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

async function writeFiles(files, words, name){
  let filename = (argv.filepath || (compileLocation + '/' + (name || argv.filename || files.map(path => {
    return path.split('/').pop().split('.')[0];
  }).join('-')))) + (argv.list ? '.txt' : '.json');
  return fs.writeFile(filename, argv.list ? Object.keys(words).join('\n') : JSON.stringify(words, null, 2));
}

function compileWords(){
  return new Promise(async resolve => {
    let files = await getFiles();
    let wordMap = await parseFiles(files);
    let words = getPosWords(Object.keys(wordMap));
    let suffixes = getSuffixes(argv.strict);
    let filterSimilar = argv.similar === true ? maxLength - 3 : argv.similar;
    if (argv.sort) words.sort(sortMap[argv.sort]);
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
    await writeFiles(files, words);
    resolve();
  });
}

function getUnions() {
  return new Promise(async resolve => {
    let files = await getFiles();
    let overlap = await parseFiles(files, true);
    console.log(overlap);
    resolve();
  });
}

function getUnique() {
  return new Promise(async resolve => {
    let files = await getFiles();
    let words = {};
    let regex = getTokenRegex();
    let paths = Array.isArray(files) ? files : [files];
    await Promise.all(
      paths.map(path => fs.readFile(path, 'utf8'))
    ).then(texts => {
      texts.shift().replace(regex, (m, g1) => {
        words[g1.toLowerCase()] = true;
      });
      texts.forEach(text => {
        text.replace(regex, (m, g1) => delete words[g1.toLowerCase()]);
      });
    })
    console.log(Object.keys(words).length);
    await writeFiles(files, words, paths[0].split('/').pop().split('.')[0] + '-unique');
    resolve();
  });
}

const deleteFlagParser = /\s*\b([a-zA-Z]+)\s*[#](?:\b|\r|\n|\s+)*/gmi;
const deletedWordParser = /\s*\b([a-zA-Z]+)\s*[#]*(?:\b|\r|\n|\s+)*/gmi;

function deleteMarked() {
  return new Promise(async resolve => {
    let files = await getFiles();
    let paths = Array.isArray(files) ? files : [files];
    let deletedWords = {};
    Promise.all(
      paths.map(path => fs.readFile(path, 'utf8'))
    ).then(texts => {
      texts.forEach(text => {
        text.replace(deleteFlagParser, (m, g1) => {
          deletedWords[g1.toLowerCase()] = true;
          return m;
        })
      });
      Promise.all(
        texts.map((text, i) => {
          let modified = text.replace(deletedWordParser, (m, g1) => {
            return deletedWords[g1.toLowerCase()] ? '' : m;
          });
          return fs.writeFile(paths[i], modified);
        })
      ).then(() => resolve());
    })
  });
}

gulp.task('purge', deleteMarked);
gulp.task('overlap', getUnions);
gulp.task('unique', getUnique);
gulp.task('compile', compileWords);