
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


let compileLocation = 'data/json';
const defaultBlockedPoS = 'VBD,VBG,VBN,VBZ,NNS';
const wordFiles = [
  'data/raw/bip-39.txt',
  'data/raw/plants.txt',
  'data/raw/animals.txt',
  'data/raw/google-books-modified.txt',
  // 'data/raw/eff-long-list.txt',
  // 'data/raw/bip-39.txt',
  // 'data/raw/gutenberg-15k.txt',
  // 'data/raw/verbs.txt',
  // 'data/raw/plants.txt',
  // 'data/raw/animals.txt',
  //'data/raw/10k.txt',
  //'data/raw/100k.txt'
];

function constructRegexp(options = {}){
  return new RegExp(`\\b([a-zA-Z]{${options.min || 3},${options.max || 8}})(?::|,|\\r|\\n|\\s+)`, 'gmi');
}

async function parseFiles(args, files){
  let words = {};
  let regex = constructRegexp(args);
  await Promise.all(
    (Array.isArray(files) ? files : [files]).map(path => fs.readFile(path, 'utf8'))
  ).then(texts => {
    texts.forEach(text => text.replace(regex, (m, g1) => words[g1.toLowerCase()] = true))
  })
  return words;
}

function filterSimilar(wordMap, sort) {
  let words = Object.keys(wordMap);
  if (sort) words.sort((a, b) => a.length - b.length || a.localeCompare(b))
  return words.filter(word => {
    if (word.length < 5) return true;
    if (word[0] === word[1]) return false;
    let pluralRoot = word.slice(0,-1);
    let tensedRoot = word.slice(0,-2);
    let similar = word.slice(0,6);
    return !(wordMap[pluralRoot] || wordMap[tensedRoot] || word.length > 6 && wordMap[similar])
  });
}

function compileWords(){
  let posRegex = argv.posfilter ? 
                  new RegExp((argv.posfilter === true ? defaultBlockedPoS : argv.posfilter).replace(/\s*,\s*/gi, '|') + '\\b', 'i')
                  : false;
  return new Promise(async resolve => {
    await fs.ensureDir(compileLocation);
    let files = argv.files ? JSON.parse(argv.files) : wordFiles;
    let words = await parseFiles(argv, files);
    words = argv.samefilter ? filterSimilar(words, argv.sort) : Object.keys(words);
    words = partsOfSpeech.tag(words).taggedWords;
    if (argv.sort) words.sort((a, b) => a.token.localeCompare(b.token))
    words = words.reduce((entries, word) => {
      if (!posRegex || !word.tag.match(posRegex)) {
        entries[word.token] = word.tag;
      }
      return entries;
    }, {});
    await fs.writeFile(compileLocation + '/words.json', JSON.stringify(words, null, 2));
    resolve();
  });
}

function reduceRaw(){
  return new Promise(async resolve => {
    let words = await parseFiles(argv, argv.file);
    let filtered = filterSimilar(words);
    await fs.writeFile(argv.force ? argv.file : compileLocation +  '/' + argv.file.split('/').pop(), filtered.join('\n'));
    resolve();
  });
}

function posFilter(){
  return new Promise(async resolve => {
    let pos = argv.pos.split(',').reduce((pos, s) => {
      pos[s.trim()] = 1;
      return pos;
    }, {})
    let words = await parseFiles(argv, argv.file);
    let filtered = partsOfSpeech.tag(Object.keys(words)).taggedWords           
      .sort((a, b) => a.token.localeCompare(b.token))
      .reduce((words, word) => {
        if (pos[word.tag]) {
          words[word.token] = word.tag;
        }
        return words;
      }, {});
    await fs.writeFile(compileLocation +  '/' + argv.file.split('/').pop().split('.')[0] + '-' + Object.keys(pos).join('-') + '.json', JSON.stringify(filtered, null, 2));
    resolve();
  });
}

gulp.task('compile', compileWords);
gulp.task('reduce', reduceRaw);
gulp.task('pos', posFilter);