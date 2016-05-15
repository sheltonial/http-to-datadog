# http-to-datadog forwarder

An extremely simple HTTP to datadog forwarder.

# Usage

## Installation

```
npm install http-to-datadog
```

## Configuration and running

```
require('http-to-datadog').startServer({});
```

### Options

Can be set through javascript object or environment variables:

#### Example

```
const options = {
    port: 80,  # PORT
    sinkHost: 'dd-agent', # DDAGENT_HOST
    sinkPort: 8125, # DDAGENT_PORT
    appPath: '/v1/send', # APP_PATH
    allowOrigin: '*', # ALLOW_ORIGIN
    tags: ['environment:development'] # TAGS=environment:development,othertag:value
}
require('http-to-datadog').startServer(options);

```
