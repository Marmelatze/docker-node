'use strict';

var Promise = require("bluebird");

var _ = require("lodash");

Promise.promisifyAll(require("consul"));
Promise.promisifyAll(require("consul/lib/agent"));
Promise.promisifyAll(require("consul/lib/agent/service"));

var consul = require("consul")({
    host: "consul"
});


Promise.promisifyAll(require("dockerode").prototype);
Promise.promisifyAll(require("dockerode/lib/container").prototype);

var Docker = require("dockerode");
var docker = new Docker({socketPath: "/var/run/docker.sock"});

var oldInfluxdbIp = undefined;
function startCadvisor(influxdb) {
    console.log(influxdb);
    if (oldInfluxdbIp == influxdb.Address) {
        console.log("not changed");
        return;
    }
    oldInfluxdbIp = influxdb.Address;
    var container = docker.getContainer("cadvisor");
    container
        .stopAsync()
        .catch(function (e) {
        })
        .then(function (result) {
            return container.removeAsync();
        })
        .catch(function (e) {
            console.error(e);
        })
        .then(function () {
            return docker.createContainerAsync({
                Image: "google/cadvisor",
                Cmd: ["-storage_driver=influxdb", "-storage_driver_host=" + influxdb.Address + ":" + influxdb.Port],
                name: "cadvisor",
                Tty: false,
                HostConfig: {
                    "Binds": [
                        "/:/rootfs:ro",
                        "/var/run:/var/run:rw",
                        "/sys:/sys:ro",
                        "/var/lib/docker/:/var/lib/docker:ro"
                    ]
                }
            });
        })
        .then(function (container) {
            console.log("container id", container.id);
            return container.startAsync();
        });
    ;
}

//consul.catalog.service.nodes("influxdb", function(err, result) {
//    if (err) throw err;
//    for (var i = 0; i < result.length; i++) {
//        var service = result[i];
//        if (service.ServicePort !== 8086) {
//            continue;
//        }
//        startCadvisor(service);
//    }
//});

/*
var watch = consul.watch({method: consul.catalog.service.nodes, options: {service: "influxdb"}});
watch.on("change", _.debounce(function (data) {
    console.log("change");
    //console.log(data);

    // get healthy influxdb
    consul.health.service({service: "influxdb", passing: 1}, function (err, result) {
        for (var i = 0; i < result.length; i++) {
            var check = result[i];
            var service = check.Service;
            if (service.Port !== 8086) {
                continue;
            }
            startCadvisor(service);
        }
    });

}, 1000));
*/
function cleanup() {
    console.log("running cleanup on local node");

    Promise.join(
        docker.listContainersAsync(),
        consul.agent.servicesAsync(),
        function(containers, services) {
            services = _.filter(services[0], function(service) {
                var containerName = service.ID.split(":")[1];
                service.containerName = containerName;
                return undefined !== containerName;
            });

            var containerIndex = _.map(containers, function(container) {
                return container.Names[0].substr(1);
            });

            var promises = [];
            _.each(services, function(service) {
                if (containerIndex.indexOf(service.containerName) !== -1) {
                    return;
                }

                console.log("Delete service " + service.ID);
                promises.push(consul.agent.service.deregisterAsync(service.ID));
            });

            return promises;
        }
    ).done(function() {
        console.log("done");
    });
};

cleanup();


// cleanup
setInterval(function () {
    cleanup();
}, 1000 * 60 * 5);

