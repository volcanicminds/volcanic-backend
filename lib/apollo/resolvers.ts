/* eslint-disable @typescript-eslint/no-explicit-any */
'use strict'

import { MyContext } from './context.js'

const resolvers = {
  Query: {
    helloWorld: (_parent: any, _args: any, context: MyContext, _info: any) => context.greeting
  }
}

export default resolvers
