"use strict";

const EventEmitter = require("events");
const ReconnectingWebSocket = require("reconnecting-websocket")
const WebSocket = require("ws");

class BitstampStream extends EventEmitter {
    constructor(opts = {}, url="wss://ws.bitstamp.net"){
        super();
        this.EVENT_UNSUBSCRIPTION_SUCCEEDED = "bts:unsubscription_succeeded";
        this.EVENT_SUBSCRIPTION_SUCCEEDED = "bts:subscription_succeeded";
        this.EVENT_REQUEST_RECONNECT = "bts:request_reconnect";
        this.EVENT_HEARTBEAT = "bts:heartbeat";

        this.CHANNEL_LIVE_TRADES = "live_trades";
        this.CHANNEL_LIVE_ORDERS = "live_orders";
        this.CHANNEL_ORDER_BOOK = "order_book";
        this.CHANNEL_DETAIL_ORDER_BOOK = "detail_order_book";
        this.CHANNEL_DIFF_ORDER_BOOK = "diff_order_book";

        this.CHANNEL_MY_ORDERS = "private-my_orders";
        this.CHANNEL_MY_TRADES = "private-my_trades";

        this.url = url;

        const {
            polling_interval,
            token,
        } = opts;
        this.polling_interval = polling_interval;
        this.token = token.token;
        this.user_id = token.user_id;

        this.connect();
        this.ws.addEventListener("open", () => {
            super.emit("connected");
            this.heartbeat = true;
            if (this.polling_interval)
                this.poll = setInterval(this._onPollHandler.bind(this), this.polling_interval);
        });
        this.ws.addEventListener("close", () => {
            super.emit("disconnected");
            if (this.polling_interval)
                clearInterval(this.poll);
        });
        this.ws.addEventListener("message", this._onMessageHandler.bind(this));
    }

    subscribe(channelBase, currencyPair){
        let channel;
        if (channelBase.startsWith(this.CHANNEL_MY_ORDERS) ||
            channelBase.startsWith(this.CHANNEL_MY_TRADES)) {
            channel = `${channelBase}_${currencyPair}-${this.user_id}`;
        } else {
            channel = `${channelBase}_${currencyPair}`;
		}
        const auth = this.token;
        this._send("bts:subscribe", { channel, auth });
        return channel;
    }

    unsubscribe(channelBase, currencyPair){
        const channel = `${channelBase}_${currencyPair}`;
        this._send("bts:unsubscribe", { channel });
    }

    unsubscribeAll(){
        for (const channel of this.subscriptions) {
            this._send("bts:unsubscribe", { channel });
        }
    }

    connect(){
        const options = {
            WebSocket, // custom WebSocket constructor
            connectionTimeout: 1000,
            maxRetries: 10,
        };
        this.ws = new ReconnectingWebSocket(this.url, [], options);
        this.subscriptions = new Set();
    }

    reconnect(){
        this.close();
        this.connect();
    }

    _onPollHandler(){
       if (!this.heartbeat) {
            clearInterval(this.poll);
            super.emit("unresponsive");
		} else {
            this._send("bts:heartbeat", {});
            this.heartbeat = false;
		}
    }

    _send(event, data){
        this.ws.send(JSON.stringify({ event, data }));
    }

    _onMessageHandler(messageEvent){
        if (messageEvent.data) {
            let msg;
            try {
                msg = JSON.parse(messageEvent.data);
            } catch (e) {
                super.emit('error', e);
                return;
            }
            let {data, event, channel} = msg;

            if (event === this.EVENT_UNSUBSCRIPTION_SUCCEEDED) {
                this.subscriptions.delete(channel);
                super.emit("unsubscribed");
            } else if (event === this.EVENT_SUBSCRIPTION_SUCCEEDED) {
                this.subscriptions.add(channel);
                super.emit("subscribed");
            } else if (event === this.EVENT_REQUEST_RECONNECT) {
                this.reconnect();
            } else if (event === this.EVENT_HEARTBEAT) {
                this.heartbeat = true;
            } else {
                if (channel.startsWith(this.CHANNEL_LIVE_TRADES) || channel.startsWith(this.CHANNEL_LIVE_ORDERS) ||
                    channel.startsWith(this.CHANNEL_MY_ORDERS) || channel.startsWith(this.CHANNEL_MY_TRADES)) {
                    data = {...data, cost: data.amount * data.price};
                }
                super.emit(channel, { data, event });
            }
        }
    }

    close(){
        if (this.polling_interval)
            clearInterval(this.poll);
        if(this.ws){
            return this.ws.close();
        }
    }
}

module.exports = BitstampStream;
