# NPM

[more info](https://zellwk.com/blog/publish-to-npm/)

## how to publish

```ruby
npm install npm@latest -g
npm login
npm init --scope=volcanicminds
npm publish --access public
```

The usual path is the `release` job in `.github/workflows/ci.yml`, on a `v*` tag: it picks `next`
for a version with a suffix and `latest` otherwise. By hand, a prerelease needs the tag spelled
out (npm refuses one without it), and `prepublishOnly` runs `check-all` and the tests, so export
`DATABASE_URL` first or the Postgres suites skip:

```ruby
npm publish --access public --tag next
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
