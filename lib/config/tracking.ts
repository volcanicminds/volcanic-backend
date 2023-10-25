module.exports = {
  config: {
    enableAll: false, // optional, default true
    changeEntity: 'Change', // optional, default 'Change'
    primaryKey: 'id' // optional, default 'id'
  },
  changes: [
    // {
    //   enable: true,
    //   method: 'POST',
    //   path: '/example',
    //   fields: { includes: ['fieldToTrack', 'fieldToTrack2'], excludes: [] },
    //   entity: 'Example', // valid Entity name
    //   changeEntity: 'Change', // optional, default config.changeEntity or 'Change'
    //   primaryKey: 'id' //optional, default config.primaryKey or 'id'
    // }
  ]
}
