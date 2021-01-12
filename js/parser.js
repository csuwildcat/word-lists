


export default {
  async filter(files, options = {}) {
    let words = {};
    let regex = new RegExp(`\\b([a-zA-Z]{${options.min || 3},${options.max || 8}})(?::|,|\\n)`, 'gmi')
    await Promise.all(files.map(path => {
      return fetch(path).then(async raw => {
        let text = await raw.text();
        text.replace(regex, (m, g1) => words[g1.toLowerCase()] = 1)
      })
    }))
    return Object.keys(words); //.join('\n') new line list
  }
}