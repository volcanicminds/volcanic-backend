import { expect } from 'expect'

export default () => {
  describe('A simple test', () => {
    it('should log useless message', async () => {
      expect(100).toBeGreaterThan(0)
    })
  })
}
