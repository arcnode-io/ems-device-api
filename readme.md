# EMS Device API 🌳

![](https://img.shields.io/gitlab/pipeline-status/arcnode-io/ems-device-api?branch=main&logo=gitlab)
![](https://gitlab.com/arcnode-io/ems-device-api/badges/main/coverage.svg)
![](https://img.shields.io/badge/24-gray?logo=nodedotjs)
![](https://img.shields.io/badge/5.8.3-gray?logo=typescript)
![](https://img.shields.io/badge/web_framework-nestjs-E0234E)
![](https://img.shields.io/badge/ORM-typeorm-5DBE5C)

## 📖 About

The API is designed to manage a structure of devices. The devices could be hierarchical if necessary. The structure is organized as follows:

- **Devices**: There can be many devices. They can be nested. Currently, this api is only two levels deep, for example, `device-0` and `device-1`, but the structure could go deeper in the future.

## Diagrams

```plantuml
rectangle "Device Level 0" as device0 {
  rectangle "Device 0A" as d0a
  rectangle "Device 0B" as d0b
  rectangle "Device 0C" as d0c
}

rectangle "Device Level 1" as device1 {
  rectangle "Device 1A" as d1a
  rectangle "Device 1B" as d1b
  rectangle "Device 1C" as d1c
  rectangle "Device 1D" as d1d
}

d0a -d-> d1a
d0a -d-> d1b
d0b -d-> d1c
d0c -d-> d1d

note right of device0
  Parent devices
  Accessed via /devices-0/:device0Id
end note

note right of device1
  Child devices
  Accessed via /devices-0/:device0Id/devices-1/:device1Id
end note
```



### Topology Creation Flow

```plantuml
participant client
participant device_api
database typeorm_db

client -> device_api: POST /topology
device_api -> typeorm_db: save device sitemap
device_api -> device_api: generate AsyncAPI v3 spec\n(topics + schemas + x-* protocol bindings)
device_api -> typeorm_db: save spec
device_api -> client: topology created
```

### Spec Consumers

```plantuml
participant device_api
participant industrial_gateway
participant ems_hmi

device_api -> industrial_gateway: GET /asyncapi\n(topics + x-modbus, x-snmp, x-connection)
device_api -> ems_hmi: GET /asyncapi\n(topics + message schemas)
```

The AsyncAPI v3 spec is the single contract for both consumers. The gateway reads `x-*` extension fields for protocol bindings (register maps, addresses). The HMI reads message schemas for type generation. Same spec, different projections.

### Build-time vs runtime

The spec serves two purposes at different times:

- **Build-time**: Message schemas (e.g. `BooleanReading`, `FloatReading`, `CommandPayload`) are stable across all deployments. The HMI runs `@asyncapi/modelina` against the spec to generate TypeScript interfaces. These are compiled into the app. The gateway does the same for Rust structs.
- **Runtime**: Topic paths (e.g. `arcnode/{deployment_uuid}/{module_id}/{device_uuid}`) are deployment-specific — they depend on which modules and devices are in the DTM. These cannot be compiled in. Both gateway and HMI fetch `GET /asyncapi` at startup and resolve topic paths dynamically.

Message types are compiled. Topic paths are fetched.

When the topology changes at runtime (device added, sensor goes offline, DTM re-provisioned), device-api publishes to `system/topology-changed`. Both the gateway and HMI subscribe to this topic — on receipt they re-fetch `GET /asyncapi` and diff against their current subscriptions.



### API Endpoints

The API provides several endpoints to manage this structure:

- **POST /topology**: Creates device sitemap and generates AsyncAPI v3 spec (topics, message schemas, `x-*` protocol bindings)
- **GET /asyncapi**: Returns the generated AsyncAPI v3 spec. Consumed by both `ems-industrial-gateway` and `ems-hmi`.
- **Devices-0**: Devices at level 0 can be accessed at the `/devices-0/:device0Id` endpoint.
- **Devices-1**: Devices at level 1 can be accessed at the `/devices-0/:device0Id/devices-1/device1Id` endpoint. In this scenario `device0Id` is the parent device and `device1Id` is the child device.

