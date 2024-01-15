import { expect } from 'expect'

module.exports = () => {
  describe('A simple test', () => {
    it('should log useless message', async () => {
      expect(100).toBeGreaterThan(0)
    })
  })
}
