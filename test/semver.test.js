describe('semver', () => {
  test('simple', () => {
    const semver = require('semver')

    const verx = 'v1.2.3+'
    const valid = semver.valid(verx)
    const clean = semver.clean(verx)

    const res1 = semver.satisfies(clean, '>1.0.0 <=1.2.4')
    const res2 = semver.satisfies(clean, '>1.0')
    const res3 = semver.satisfies(clean, '>1.0 <8.0')

    console.log(verx + ' ' + valid + ' ' + clean)
    console.log(res1 + ' ' + res2 + ' ' + res3)
  })
})
