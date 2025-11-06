# NPM

[more info](https://zellwk.com/blog/publish-to-npm/)

## how to publish

```ruby
npm install npm@latest -g
npm login
npm init --scope=volcanicminds
npm publish --access public
```

## local linking

```ruby
npm link
npm link "@volcanicminds/backend"
```

```ruby
npm unlink
npm unlink "@volcanicminds/backend"
```
