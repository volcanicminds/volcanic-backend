//
// Who may create an account in a tenant (F49). The modes are validated again by the controllers,
// which also say why a value is refused; the schemas keep the shape and the response honest.
//
const modes = { type: 'string', enum: ['invite', 'approval', 'open'] }

export const accountCreationRuleBodySchema = {
  $id: 'accountCreationRuleBodySchema',
  type: 'object',
  required: ['allowed', 'default'],
  additionalProperties: false,
  properties: {
    allowed: { type: 'array', minItems: 1, items: modes },
    default: modes
  }
}

export const accountCreationRuleSchema = {
  $id: 'accountCreationRuleSchema',
  type: 'object',
  properties: {
    allowed: { type: 'array', items: modes },
    default: modes,
    // `control` when the platform stored a rule, `deployment` when the configuration applies.
    from: { type: 'string', enum: ['control', 'deployment'] },
    deployment: {
      type: 'object',
      properties: { allowed: { type: 'array', items: modes }, default: modes }
    }
  }
}

export const accountCreationChoiceBodySchema = {
  $id: 'accountCreationChoiceBodySchema',
  type: 'object',
  required: ['mode'],
  additionalProperties: false,
  properties: { mode: modes }
}

export const accountCreationStateSchema = {
  $id: 'accountCreationStateSchema',
  type: 'object',
  properties: {
    allowed: { type: 'array', items: modes },
    allowedFrom: { type: 'string', enum: ['tenant', 'control', 'deployment'] },
    default: modes,
    choice: { ...modes, nullable: true },
    mode: modes
  }
}
