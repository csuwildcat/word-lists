
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
const blockedPoS = /VBD|VBG|VBN|VBZ|NNS/;
const wordFiles = [
  'data/raw/eff-long-list.txt',
  'data/raw/bip-39.txt',
  'data/raw/gutenberg-15k.txt',
  'data/raw/verbs.txt',
  //'data/raw/100k.txt'
];

function constructRegexp(options = {}){
  return new RegExp(`\\b([a-zA-Z]{${options.min || 3},${options.max || 8}})(?::|,|\\r|\\n|\\s+)`, 'gmi');
}

function compileWords(){
  return new Promise(async resolve => {
    await fs.ensureDir(compileLocation);
    let words = [];
    let files = argv.files ? JSON.parse(argv.files) : wordFiles;
    let regex = constructRegexp(argv);
    await Promise.all(
      files.map(path => fs.readFile(path, 'utf8').then(text => {
        text.replace(regex, (m, g1) => words.push(g1.toLowerCase()))
      }))
    );
    let tagged = partsOfSpeech.tag(words).taggedWords           
      .sort((a, b) => a.token.localeCompare(b.token))
      // .sort((a, b) => a.token.length - b.token.length)
      .reduce((words, word) => {
        if (!word.tag.match(blockedPoS)) {
          words[word.token] = word.tag;
        }
        return words;
      }, {});
    await fs.writeFile(compileLocation + '/words.json', JSON.stringify(tagged, null, 2));
    resolve();
  });
}

function reduceRaw(){
  return new Promise(async resolve => {
    let words = {};
    let regex = constructRegexp(argv);
    await fs.readFile(argv.file, 'utf8').then(text => {
      text.replace(regex, (m, g1) => {
        let word = g1.toLowerCase();
        if (word[0] !== word[1]) {
          words[word] = 1
        }
      })
    })
    await fs.writeFile(argv.force ? argv.file : compileLocation +  '/' + argv.file.split('/').pop(), Object.keys(words).sort().join('\n'));
    resolve();
  });
}

function posFilter(){
  return new Promise(async resolve => {
    let words = [];
    let regex = constructRegexp(argv);
    let pos = argv.pos.split(',').reduce((pos, s) => {
      pos[s.trim()] = 1;
      return pos;
    }, {})
    await fs.readFile(argv.file, 'utf8').then(text => {
      text.replace(regex, (m, g1) => {
        let word = g1.toLowerCase();
        if (word[0] !== word[1]) words.push(word);
      })
    })
    let filtered = partsOfSpeech.tag(words).taggedWords           
      .sort((a, b) => a.token.localeCompare(b.token))
      // .sort((a, b) => a.token.length - b.token.length)
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