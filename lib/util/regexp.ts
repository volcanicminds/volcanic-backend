module.exports = {
  /*
   * min 3 max 33, one special character (. _ -) only in the middle
   * username can have uppercase or lowercase chars
   */
  username: /(?=^.{3,33}$)^[a-z][a-z0-9]*[._-]?[a-z0-9]+$/gi,
  emailAlt:
    /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/,
  /*
   * email can have multiple words
   * email can use . - or + for smart labeling
   */
  email: /^\w+([\.+-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
  /*
   * password must contain 1 number (0-9)
   * password must contain 1 uppercase chars
   * password must contain 1 lowercase chars
   * password must contain 1 non-alpha number
   * password is 8-64 characters with no space
   */
  password: /^(?=.*\d)(?=.*[A-Z])(?=.*[a-z])(?=.*[^\w\d\s:])([^\s]){8,64}$/gi,
  zipCode: /(^\d{5}$)|(^\d{5}-\d{4}$)/,
  taxCodePersona: /^[a-zA-Z]{6}[0-9]{2}[abcdehlmprstABCDEHLMPRST]{1}[0-9]{2}([a-zA-Z]{1}[0-9]{3})[a-zA-Z]{1}$/,
  /*
   * taxCode can have 2 letter (IT,DE,..) and 11 digits
   */
  taxCodeCompany: /^([A-Z]{2}|)[0-9]{11}$/,
  iban: /^[a-zA-Z]{2}[0-9]{2}[a-zA-Z0-9]{4}[0-9]{7}([a-zA-Z0-9]?){0,16}$/,
  mobilePhone: /^((00|\+)39)?3[0-9]{8,9}$/,
  landLinePhone: /^(((00|\+)39))?[\s]?(0{1}[1-9]{1,3})[\s]?(\d{4,6})$/,
  tollFreePhone: /^((00|\+)39)?(800|803|167)\d{3,6}$/
}
