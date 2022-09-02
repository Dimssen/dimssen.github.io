const db = require('./db/db');
const noblox = require('noblox.js');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const fs = require('fs')
const path = require('path')
const _ = require('lodash');
const express = require('express');
const discord = require('discord.js');
let package = require('../package.json');
const axios = require('axios')
const router = express.Router();



let activews = [];



const erouter = (usernames, pfps, settings, permissions, automation) => {
    const perms = permissions.perms;

    router.use((req, res, next) => {
        if (!settings.get('sessions')?.enabled) {
            return res.status(403).send('Forbidden');
        }
        next()
    });

    setInterval(async () => {
        let essions = await db.gsession.find({ started: false, start: { $lt: new Date() } });
        essions.forEach(async (session) => {
            let ssession = await db.gsession.findOne({ id: session.id });
            ssession.started = true;
            ssession.did = await sendlog(session);
            var whoTime = new Date(ssession.start);
            whoTime.setHours(whoTime.getHours() + 1);
            let blsu = axios.put('https://api.teamup.com/kshwi9ugi29idmnm95/events/'+ssession.teamupid, {
              id: ssession.teamupid,
              subcalendar_ids: [
                10915469
              ],
              start_dt: ssession.start,
              end_dt: whoTime.toISOString().split('.')[0]+"Z",
              title: "Session #"+ssession.id,
              who: await noblox.getUsernameFromId(ssession.uid),
              custom: {status:["in_progress"]}
              }, { headers: {
                "Teamup-Token":"d0aaa5ba10f7c6fef6f87b4c4a8198a0f5a8ab4aa80591a9f6dac623d4658be4",
                'Content-Type': 'application/json',
              }
            });
            automation.runEvent('sessionstarted', {
                type: ssession.type.name,
                id: ssession.id,
                username: await fetchusername(ssession.uid),
                game: ssession.type.gname,
            });
            await ssession.save();
        });
    }, 60000)

    async function sendlog(data) {
        if (!settings.get('sessions')?.discohook) return null;
        let webhook = settings.get('sessions').discohook;
        
        let webhookc = new discord.WebhookClient({ url: webhook });
        let username = await fetchusername(data.uid);
        let pfp = await fetchpfp(data.uid);

        let embed = new discord.MessageEmbed()
            .setTitle(`<:tropical:985491746412711996>  Tropicál Shifts`)
            .setDescription(`A shift is now being hosted by ${username}!\nCome down to the Juice Bar and grab a drink! :)\n\n:link: https://www.roblox.com/games/${data.type.gid}`)
            .setImage(data.thumbnail)

        let components = new discord.MessageActionRow()
            .addComponents(
                new discord.MessageButton({ style: 'LINK', label: 'Join', url: `https://www.roblox.com/games/${data.type.gid}/-` })
            );
        

        let msg = await webhookc.send({ content: settings.get('sessions').discoping.length ? settings.get('sessions').discoping : null, embeds: [embed], components: [components] }).catch(err => {
        });
        
        return msg?.id;
    }

    async function unsendlog(data) {
        if (!settings.get('sessions')?.discohook) return null;
        if (!data?.did) return null;

        let webhook = settings.get('sessions').discohook;

        let webhookc = new discord.WebhookClient({ url: webhook });
        let username = await fetchusername(data.uid);
        let pfp = await fetchpfp(data.uid);

        let embed = new discord.MessageEmbed()
            .setTitle(`<:tropical:985491746412711996>  Tropicál Shifts`)
            .setDescription(`The shift hosted by ${username} has ended.\nYou can view the next session on the calender!\n\n:link: https://teamup.com/ksq8hbpx8ej9oemi9j`);

        let msg = await webhookc.editMessage(data.did, { content: null, embeds: [embed], components: [] }).catch(err => {
        });
        return msg.id;
    }
    
    router.post('/session/end', perms('host_sessions'),  async (req, res) => {
        if (!req.body?.id) return res.status(400).send({ success: false, message: 'No session id provided' });
        if (typeof req.body.id !== 'number') return res.status(400).send({ success: false, message: 'Session id must be a number' });
        let session = await db.gsession.findOne({ id: req.body.id });
        if (!session) res.status(404).send('Session not found');

        session.end = new Date();
        session.save();
        automation.runEvent('sessionended', {
            type: session.type.name,
            id: session.id,
            username: await fetchusername(session.uid),
            game: session.type.gname,
        });

        await unsendlog(session);

        res.status(200).send({ success: true });
    });

    router.get('/session/:id', async (req, res) => {
        if (!req.params.id) return res.status(400).send({ success: false, message: 'No session id provided' });
        if (typeof req.params.id !== 'string') return res.status(400).send({ success: false, message: 'Session id must be a number' });
        let session = await db.gsession.findOne({ id: req.params.id });
        if (!session) return res.status(404).send({ success: false, error: 'Session not found' });

        let data = {
            ...session._doc,
            user: {
                username: await fetchusername(session.uid),
                pfp: await fetchpfp(session.uid),
            },
        };
        res.send({ success: true, data });
    })

    router.get('/list', async (req, res) => {
        let sessions = await db.gsession.find({});
        let mx = await Promise.all(sessions.map(async m => {
            return {
                ...m._doc,
                user: {
                    username: await fetchusername(m.uid),
                    pfp: await fetchpfp(m.uid),
                },
            };
        }));
        res.status(200).send(mx);
    })

    //session db is db.gsession
    router.get('/games', perms('host_sessions'), async (req, res) => {
        

        let games = settings.get('sessions').games;
        let game = await noblox.getUniverseInfo(games.map(m => m.id))

        res.send(games.map(m => {
            let e = game.find(f => f.id == m.id);
            return {
                type: m.type,
                id: m.id,
                gameinfo: {
                    name: e?.name,
                    description: e?.description,
                }
            }
        }));
    });

    router.post('/hostsession', perms('host_sessions'), async (req, res) => {
        let data = req.body;
        let id = parseInt(await db.gsession.countDocuments({}));
        let treq = await axios.get(`https://thumbnails.roblox.com/v1/games/multiget/thumbnails?universeIds=${req.body.game}&size=768x432&format=Png&isCircular=false`);
        let thumbnail = treq.data.data[0]?.thumbnails[0]?.imageUrl;
        let ginfo = await noblox.getUniverseInfo(req.body.type);
        var whaTime = new Date(data.date);
            whaTime.setHours(whaTime.getHours() + 1);
        let chest = await axios.post('https://api.teamup.com/kshwi9ugi29idmnm95/events', {
            subcalendar_ids: [
                10915469
            ],
            start_dt: data.date.split('.')[0]+"Z",
            end_dt: whaTime.toISOString().split('.')[0]+"Z",
            title: "Session #"+(id+1).toString(),
            who: await noblox.getUsernameFromId(req.session.userid),
            custom: {status:["scheduled"]}
           }, { headers: {
            "Teamup-Token":"d0aaa5ba10f7c6fef6f87b4c4a8198a0f5a8ab4aa80591a9f6dac623d4658be4",
        }
    }).then((response) => fosh = response.data.event.id);
        let dbdata = {
            id: id + 1,
            start: data.date || Date.now(),
            uid: req.session.userid,
            thumbnail,
            started: data.now,
            teamupid: fosh,
            type: {
                id: req.body.type,
                name: settings.get('sessions').games.find(f => f.id == req.body.type)?.type,
                gname: ginfo[0].name,
                gid: ginfo[0].rootPlaceId,
            },
        };
        if (data.now) dbdata.did = await sendlog(dbdata);
        if (data.now) automation.runEvent('sessionstarted', {
            type: dbdata.type.name,
            id: dbdata.id,
            username: await fetchusername(dbdata.uid),
            game: dbdata.type.gname,
        });

        await db.gsession.create(dbdata);

        //let webhook = new WebhookClient()

        res.send({
            ...dbdata,
            user: {
                username: await fetchusername(req.session.userid),
                pfp: await fetchpfp(req.session.userid),
            },
        })
    })



    async function fetchusername(uid) {
        if (usernames.get(uid)) {
            return usernames.get(uid);
        }
        let userinfo = await noblox.getUsernameFromId(uid);
        usernames.set(parseInt(uid), userinfo, 10000);

        return userinfo;
    }

    async function fetchpfp(uid) {
        if (pfps.get(uid)) {
            return pfps.get(uid);
        }
        let pfp = await noblox.getPlayerThumbnail({ userIds: uid, cropType: "headshot" });
        pfps.set(parseInt(uid), pfp[0].imageUrl, 10000);

        return pfp[0].imageUrl
    }

    return router;
}

module.exports = erouter
