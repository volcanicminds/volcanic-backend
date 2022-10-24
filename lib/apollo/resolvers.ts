'use strict'

import { MyContext } from './context'

const resolvers = {
  Query: {
    helloWorld: (parent: any, args: any, context: MyContext, info: any) => context.greeting
  }
}

export default resolvers
