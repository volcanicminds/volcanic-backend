module.exports = async (req, reply, error) => {
  log.e && log.error(`${error}`)
  log.t && log.trace(error)
}
