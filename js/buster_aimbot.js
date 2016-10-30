// Main code for the Buster aimbot
// This code is loaded before the slightly modified game.js

var cannon_reloaded = true;
var upgrades_available = false;
var max_velocity_samples = 1;
var pending_fire = false;
var bot_name = "hai";
var bot_classindex = 4;
var cannon_speed = 2; // pixels(?) per millisecond

var enemy_database = new Map();
var ignore_sid = new Set();

window.localStorage = null;

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function compute_cartesian_distance(x1, y1, x2, y2) {
    return MathSQRT((x2 -= x1) * x2 + (y2 -= y1) * y2)
}

function compute_distance(other_obj) {
    return compute_cartesian_distance(other_obj.x, other_obj.y, player.x, player.y)
}

function chat(data) {
    socket.emit("c", data);
}

function is_targetable(player_obj) {
    return player_obj != null && player_obj.isPlayer == true && player_obj.sid != player.sid && player_obj.visible && !player_obj.dead && player_obj.spawnProt == 0 && !ignore_sid.has(player_obj.sid)
}

function initialize_enemy_info(player_obj) {
    let current_info = null;
    if (enemy_database.has(player_obj.sid)) {
        current_info = enemy_database.get(player_obj.sid);
    } else {
        current_info = new Object();
        current_info.last_x = null;
        current_info.last_y = null;
        current_info.last_time = null;
    }
    current_info.min_delta_t = Infinity;
    current_info.velocities = new Array();
    enemy_database.set(player_obj.sid, current_info);
}

function update_position_time(player_obj) {
    let current_time = Date.now();
    if (player_obj && ("sid" in player_obj) && ("x" in player_obj) && ("y" in player_obj)) {
        if (!enemy_database.has(player_obj.sid) || !player_obj.visible) {
            initialize_enemy_info(player_obj);
        }
        let enemy_info = enemy_database.get(player_obj.sid);
        if (enemy_info.velocities.length >= max_velocity_samples) {
            initialize_enemy_info(player_obj);
            enemy_info = enemy_database.get(player_obj.sid);
        }
        //if (player_obj.x == enemy_info.last_x && player_obj.y == enemy_info.last_y) {
        //    return;
        //}
        let delta_t = current_time - enemy_info.last_time;
        if (enemy_info.last_time == null) {
            delta_t = Infinity;
        }
        enemy_info.last_time = current_time;
        let velocity_components = new Object();
        if (delta_t == 0) {
            velocity_components.x = 0;
            velocity_components.y = 0;
            velocity_components.delta_t = Infinity;
        } else {
            velocity_components.x = (player_obj.x - enemy_info.last_x)/delta_t;
            velocity_components.y = (player_obj.y - enemy_info.last_y)/delta_t;
            velocity_components.delta_t = delta_t;
            if (delta_t < enemy_info.min_delta_t) {
                enemy_info.min_delta_t = delta_t;
            }
        }
        enemy_info.velocities.push(velocity_components);
        enemy_info.last_x = player_obj.x;
        enemy_info.last_y = player_obj.y;
    }
    if (window.pending_fire) {
        window.pending_fire = false;
        socket.emit("3");
    }
}

function get_player_velocity(player_obj) {
    let enemy_info = enemy_database.get(player_obj.sid);
    let x_average_num = 0;
    let y_average_num = 0;
    let average_den = 0;
    for (let current_velocity of enemy_info.velocities) {
        //let weight = (1/enemy_info.velocities.length)*current_velocity.delta_t/enemy_info.min_delta_t;
        let weight = 1;
        x_average_num += current_velocity.x*weight;
        y_average_num += current_velocity.y*weight;
        average_den += weight;
    }
    if (average_den == 0) {
        average_den = Infinity;
    }
    let velocity_components = new Object();
    velocity_components.x = x_average_num/average_den;
    velocity_components.y = y_average_num/average_den;
    return velocity_components;
}

function get_player_pos_relative(player_obj) {
    let result = new Object();
    result.x = player_obj.x - player.x;
    result.y = player_obj.y - player.y;
    return result;
}

function get_time_determinant(player_obj) {
    let v = get_player_velocity(player_obj);
    let p0 = get_player_pos_relative(player_obj);
    let b = 2*(v.x*p0.x + v.y*p0.y);
    let a = Math.pow(v.x, 2) + Math.pow(v.y, 2) - Math.pow(cannon_speed, 2);
    let c = Math.pow(p0.x, 2) + Math.pow(p0.y, 2);
    return Math.pow(b, 2) - 4*a*c;
}

function get_collision_time(player_obj) {
    let det = get_time_determinant(player_obj);
    if (det < 0) {
        // Ball never hits
        return null;
    }
    let p0 = get_player_pos_relative(player_obj);
    let v = get_player_velocity(player_obj);
    let b = 2*(v.x*p0.x + v.y*p0.y);
    let a = Math.pow(v.x, 2) + Math.pow(v.y, 2) - Math.pow(cannon_speed, 2);
    //let c = Math.pow(p0.x, 2) + Math.pow(p0.y, 2);
    return Math.min((-b + Math.sqrt(det))/(2*a), (-b - Math.sqrt(det))/(2*a));
}

function get_aiming_angle(player_obj) {
    let hit_time = get_collision_time(player_obj);
    let v = get_player_velocity(player_obj);
    let p0 = get_player_pos_relative(player_obj);
    return Math.atan2(v.y*hit_time + p0.y, v.x*hit_time + p0.x);
}

class CircleMapIdling {
    constructor() {
        this.target_arc_length = 200; // screen-independent pixels
    }

    polar_arg(angle) {
        return angle;
    }

    x_cart(angle) {
        return (map.heightH-map.trackWidth*4/5)*MathCOS(this.polar_arg(angle));
    }

    y_cart(angle) {
        return (map.heightH-map.trackWidth*4/5)*MathSIN(this.polar_arg(angle));
    }

    get_target_position() {
        let return_values = new Object();
        let map_radius = map.heightH - map.trackWidthH;
        // Calculate new position polar angle relative to center of circle map (in radians)
        let new_angle = MathATAN2(player.y, player.x);
        new_angle -= this.target_arc_length/map_radius;
        return_values.x = this.x_cart(new_angle);
        return_values.y = this.y_cart(new_angle);
        return return_values;
    }
}
var circle_map_idling = new CircleMapIdling();

class SquareMapIdling {
    constructor() {
        this.target_arc_length = 10; // screen-independent pixels
    }

    normalize_angle(angle) {
        angle %= 2*MathPI;
        if (angle < 0) {
            angle += 2*MathPI;
        }
        return angle;
    }

    x_cart(angle) {
        angle = this.normalize_angle(angle);
        if (angle > 7*MathPI/4 || angle <= MathPI/4) {
            // Right side of map
            return map.widthH - map.trackWidthH;
        } else if (angle > MathPI/4 && angle <= 3*MathPI/4) {
            // Bottom side of map
            return map.widthH - (angle - MathPI/4)/(MathPI/2)*(map.width - map.trackWidth);
        } else if (angle > 3*MathPI/4 && angle <= 5*MathPI/4) {
            // Left side of map
            return -map.widthH + map.trackWidthH;
        } else if (angle > 5*MathPI/4 && angle <= 7*MathPI/4) {
            // Top side of map
            return (angle - 5*MathPI/4)/(MathPI/2)*(map.width - map.trackWidth) - map.widthH;
        } else {
            console.error("Invalid angle (divided by MathPI): " + angle/MathPI);
        }
    }

    y_cart(angle) {
        angle = this.normalize_angle(angle);
        if (angle > 7*MathPI/4) {
            // Right side of map, top half
            return -(angle - 7*MathPI/4)/(MathPI/4)*map.heightH;
        } else if (angle <= MathPI/4) {
            // Right side of map, bottom half
            return (MathPI/4 - angle)/(MathPI/4)*(map.heightH - map.trackWidthH);
        } else if (angle > MathPI/4 && angle <= 3*MathPI/4) {
            // Bottom side of map
            return map.heightH - map.trackWidthH;
        } else if (angle > 3*MathPI/4 && angle <= 5*MathPI/4) {
            // Left side of map
            return (5*MathPI/4 - angle)/(MathPI/2)*(map.height - map.trackWidth) - map.heightH;
        } else if (angle > 5*MathPI/4 && angle <= 7*MathPI/4) {
            // Top side of map
            return -map.heightH + map.trackWidthH;
        } else {
            console.error("Invalid angle (divided by MathPI): " + angle/MathPI);
        }
    }

    get_target_position() {
        let return_values = new Object();
        let map_radius = map.heightH - map.trackWidthH;
        // Calculate new position polar angle relative to center of circle map (in radians)
        let new_angle = MathATAN2(player.y, player.x);
        new_angle -= this.target_arc_length/map_radius;
        return_values.x = this.x_cart(new_angle);
        return_values.y = this.y_cart(new_angle);
        return return_values;
    }
}
var square_map_idling = new SquareMapIdling();

function get_idling_target() {
    let return_values = new Object();
    if (map.shape == "circle") {
        let target_position = circle_map_idling.get_target_position();
        return_values.angle = MathATAN2(target_position.y - player.y, target_position.x - player.x);
        return_values.distance = 200*compute_cartesian_distance(player.x, player.y, target_position.x, target_position.y);
    } else if (map.shape == "square") {
        let target_position = square_map_idling.get_target_position();
        return_values.angle = MathATAN2(target_position.y - player.y, target_position.x - player.x);
        return_values.distance = 200*compute_cartesian_distance(player.x, player.y, target_position.x, target_position.y);
    } else {
        // Make idling position the middle of start line
        let idle_x = 0;
        let idle_y = map.heightH - map.trackWidthH;
        return_values.angle = MathATAN2(idle_y - player.y, idle_x - player.x);
        return_values.distance = (Math.random()*10).round(2) + 400;
    }
    return return_values;
}

function pseudo_enter_key() {
    enter_event = new Event("keyup");
    enter_event.keyCode = 13;
    setTimeout(function() {
        enter_event = new Event("keyup", {"bubbles": true});
        enter_event.keyCode = 13;
        userNameInput.dispatchEvent(enter_event);
        enter_event = new Event("mouseup", {"bubbles": true});
        enter_event.button = 1;
        enterGameButton.dispatchEvent(enter_event);
    }, 500);
}

// Function hooks and overrides

function hook_addChatItem(a, b, c) {
    //console.log("CHAT:", a, b, c)
}

function hook_socket_callback_spawn(a, b) {
    update_position_time(a);
    if (b) {
        console.log("Current SID: " + player.sid);
    }
}

function hook_socket_callback_5(a, b, c) {
    window.upgrades_available = false;
    if (0 < b) {
        window.upgrades_available = true;
    }
}

function hook_socket_callback_a(a) {
    if (a && a.cd) {
        window.cannon_reloaded = false;
        setTimeout(function() {
            window.cannon_reloaded = true;
        }, a.cd);
    }
}

function hook_socket_callback_7(a, b, c) {
    if (b == "x" || b == "y") {
        update_position_time(gameObjects[a]);
    }
}

function hook_updateObjectData_condition_a(a) {
    update_position_time(a);
}

function hook_updateObjectData_condition_b_loop(game_object) {
    update_position_time(game_object);
}

function hook_leaveGame() {
    pseudo_enter_key();
}

function hook_kickPlayer(a) {
    console.log("Got kicked for '" + a + "'. Reconnecting...");
    window.socket = undefined;
    window.port = undefined;
    window.kickReason = false;
    window.oldTime = 0;
    window.gameState = 0;
    window.gameOver = false;
    var partyKey = null , player = null , modeIndex = 0, modeList = undefined, gameObjects = [], map = null, currentMode = null, target = [0, 0, 0, 0], viewMult = 1, maxScreenWidth = 1920, maxScreenHeight = 1080, originalScreenWidth = maxScreenWidth, originalScreenHeight = maxScreenHeight, screenWidth = undefined, screenHeight = undefined;
    setTimeout(function() {
        hideMainMenuText();
        window.onload();
        toggleGameUI(false);
        toggleMenuUI(true);
        endBoardContainer.style.display = "none";
        pseudo_enter_key();
    }, 10000);
}

function override_sendTarget(a) {
    var b = currentTime;
    var is_tracking = false;
    if (!gameOver && player && !player.dead && (a || b - lastSent > sendFrequency)) {
        var current_min = Infinity;
        var current_obj = null;
        for (let player_obj of gameObjects) {
            if (is_targetable(player_obj)) {
                if (get_time_determinant(player_obj) >= 0) {
                    //let new_min = compute_distance(player_obj);
                    let new_min = (player_obj.health/player_obj.maxHealth)*2000;
                    new_min += (20 - player_obj.laps)*1000;
                    new_min += compute_distance(player_obj);
                    if (new_min < current_min) {
                        current_min = new_min;
                        current_obj = player_obj;
                    }
                }
            }
        }
    }
    is_tracking = Boolean(current_obj);
    if (!current_obj) {
        current_obj = player;
    }
    if (!gameOver && player && !player.dead && (a || b - lastSent > sendFrequency)) {
        lastSent = b;
        if (!is_tracking) {
            let new_target = get_idling_target();
            target[0] = new_target.angle;
            target[1] = new_target.distance;
            target[0] = target[0].round(2);
            target[1] = target[1].round(2);
        }
        if (is_tracking) {
            //target[1] = MathSQRT(MathPOW(mouseY - screenHeight / 2, 2) + MathPOW(mouseX - screenWidth / 2, 2));
            target[1] = compute_cartesian_distance(player.x, player.y, current_obj.x, current_obj.y);
            target[1] *= 9/10;
            target[1] *= MathMIN(maxScreenWidth / screenWidth, maxScreenHeight / screenHeight);
            //target[0] = MathATAN2(mouseY - screenHeight / 2, mouseX - screenWidth / 2);
            //target[0] = MathATAN2(current_obj.y - player.y, current_obj.x - player.x);
            target[0] = get_aiming_angle(current_obj);
            target[0] = target[0].round(2);
            target[1] = target[1].round(2);
            if (target[1] > 150) {
                target[2] = 1;
            } else {
                target[2] = 0;
            }
        } else {
            target[2] = 0;
        }
        if (upgrades_available && is_tracking && Math.random() < 0.5) {
            socket.emit("2", getRandomInt(49, 55)-49);
        }
        socket.emit("1", target);
        if (is_tracking && cannon_reloaded && player.spawnProt == 0) {
            window.pending_fire = true;
        }
    }
}
