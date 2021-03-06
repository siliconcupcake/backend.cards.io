import express from 'express'
import * as LiteratureController from './controller'
import * as LiteratureValidator from './validator'
import * as Validator from '../../util/validator'
import { Logger } from '../../util/logger'
import { Game } from '../../engine'
import { setUpdatesCallback } from '../../services'

let router = express.Router()
let LiteratureNamespace
let gameMap = new Map()
let socketMap = new Map()

var setupLiteratureGame = async (NamespaceObject) => {
	LiteratureNamespace = NamespaceObject
	openSocketChannels()
	setUpdatesCallback(onGameUpdate, onPlayerUpdate)
}

var getGameData = (gameCode: string): Game => {
	return gameMap.get(gameCode)
}

var setGameData = (game: Game) => {
	gameMap.set(game.code, game)
}

var removeGameData = (game: Game) => {
	gameMap.delete(game.code)
}

var filterLogs = (game: any) => {
	let result: string[] = []
	let count = 3
	for (let i = game.logs.length; i > 0; i--) {
		if (
			game.logs[i - 1].startsWith('ASK') ||
			game.logs[i - 1].startsWith('TAKE')
		) {
			if (count > 0) {
				result.push(game.logs[i - 1])
				count--
			}
		} else {
			result.push(game.logs[i - 1])
		}
	}
	game.logs = result
}

var onGameUpdate = (game: any) => {
	filterLogs(game)
	Logger.info('GAME-UPDATE[%s]', game.code, game)
	LiteratureNamespace.to(game.code).emit('game-data', {
		type: 'GAME',
		data: game
	})
}

var getCardValue = (a: string): number => {
	a = a.slice(0, -1)
	if (!isNaN(Number(a))) return Number(a)
	switch (a) {
		case 'J':
			return 11
		case 'Q':
			return 12
		case 'K':
			return 13
		case 'A':
			return 14
		default:
			return 15
	}
}

var onPlayerUpdate = (player: any, code: string) => {
	player.hand.sort((a: string, b: string): number => {
		let aValue = getCardValue(a)
		let aSet = LiteratureValidator.findBaseSet(a)
		let bValue = getCardValue(b)
		let bSet = LiteratureValidator.findBaseSet(b)

		if (aSet.value !== bSet.value) return aSet.value - bSet.value
		else return aValue - bValue
	})
	let socketId = socketMap.get(String(player.id))
	Logger.info('PLAYER-UPDATE[%s][%s]', code, player.id, player)
	LiteratureNamespace.to(socketId).emit('player-data', {
		type: 'PLAYER',
		data: player
	})
}

var openSocketChannels = (): void => {
	LiteratureNamespace.on('connection', (socket) => {
		let pid = socket.handshake.query.pid
		if (pid.length !== 0) {
			Logger.info('CONNECT[%s]', pid)
			if (socketMap.has(pid)) {
				LiteratureNamespace.to(socket.id).emit('game-updates', {
					type: 'CONNECT',
					code: 403,
					name: 'SessionError',
					message: 'Another session is already active'
				})
			} else {
				LiteratureController.handleReconnect(pid)
					.then((response) => {
						socketMap.set(pid, socket.id)
						socket.join(response.game.code)
						filterLogs(response.game)
						LiteratureNamespace.to(socket.id).emit('game-updates', {
							type: 'CONNECT',
							code: 200,
							game: response.game,
							player: response.player,
							chats: response.chats
						})
					})
					.catch((err) => {
						if (err.scope !== 'PLUCK-GAME') {
							Logger.error('RECONNECT-FAIL[%s]', pid, {
								error: {
									...err,
									msg: err.message,
									stack: err.stack
								}
							})
							LiteratureNamespace.to(socket.id).emit(
								'game-updates',
								{
									type: 'CONNECT',
									code: 400,
									name: err.name,
									message:
										err.name !== 'TypeError'
											? err.message
											: 'Unable to reconnect to game.'
								}
							)
						}
					})
			}
		}

		socket.on('create', async (data) => {
			let playerName = data.name
			let playerPosition = 1
			let playerId = data.pid

			try {
				let player = await LiteratureController.registerPlayer(
					playerId,
					playerName,
					playerPosition
				)
				let game = await LiteratureController.hostGame(player)
				var gameCode = game.code

				setGameData(game)
				socket.join(game.code)
				socketMap.set(player.id, socket.id)

				LiteratureNamespace.to(socket.id).emit('game-updates', {
					code: 200,
					type: 'CREATE',
					gcode: game.code,
					pid: player.id,
					pname: player.name
				})
			} catch (err) {
				Logger.error('CREATE-FAIL[%s][%s]', gameCode, playerId, {
					error: { ...err, msg: err.message, stack: err.stack }
				})
				LiteratureNamespace.to(socket.id).emit('game-updates', {
					type: 'CREATE',
					code: err.code,
					name: err.name,
					message:
						err.name !== 'TypeError'
							? err.message
							: 'Unable to create game.'
				})
			}
		})

		socket.on('probe', async (data) => {
			let gameCode = data.code
			try {
				let game = getGameData(gameCode)
				let response = game.getSpots()

				LiteratureNamespace.to(socket.id).emit('game-probe', {
					code: 200,
					data: response
				})
			} catch (err) {
				LiteratureNamespace.to(socket.id).emit('game-probe', {
					code: 400,
					name: 'GameError',
					message: 'No Game Found'
				})
			}
		})

		socket.on('join', async (data) => {
			let gameCode = data.code
			let playerName = data.name
			let playerPosition = data.position
			let playerId = data.pid

			try {
				let game = getGameData(gameCode)

				Validator.isPositionAvailable(game, playerPosition)
				let player = await LiteratureController.registerPlayer(
					playerId,
					playerName,
					playerPosition
				)
				await LiteratureController.joinGame(game, player)

				socket.join(game.code)
				socketMap.set(player.id, socket.id)

				let response = game.getSpots()
				LiteratureNamespace.to(socket.id).emit('game-updates', {
					code: 200,
					type: 'JOIN',
					pid: player.id,
					gcode: game.code,
					data: response
				})
			} catch (err) {
				Logger.error('JOIN-FAIL[%s][%s]', gameCode, playerId, {
					error: { ...err, msg: err.message, stack: err.stack }
				})
				LiteratureNamespace.to(socket.id).emit('game-updates', {
					type: 'JOIN',
					code: err.code,
					name: err.name,
					message:
						err.name !== 'TypeError'
							? err.message
							: 'Unable to join game.'
				})
			}
		})

		socket.on('leave', async (data) => {
			let gameCode = data.code
			let playerId = data.pid

			try {
				let game = getGameData(gameCode)
				let player = game.getPlayerById(playerId)

				let success = await LiteratureController.leaveGame(game, player)
				socket.leave(game.code)
				if (!success) removeGameData(game)

				LiteratureNamespace.to(socket.id).emit('game-updates', {
					code: 200,
					type: 'LEAVE'
				})
			} catch (err) {
				Logger.error('LEAVE-FAIL[%s][%s]', gameCode, playerId, {
					error: { ...err, msg: err.message, stack: err.stack }
				})
				LiteratureNamespace.to(socket.id).emit('game-updates', {
					type: 'LEAVE',
					code: err.code,
					name: err.name,
					message:
						err.name !== 'TypeError'
							? err.message
							: 'Unable to leave game.'
				})
			}
		})

		socket.on('start', (data) => {
			let gameCode = data.code
			let playerId = data.pid

			try {
				let game = getGameData(gameCode)
				let player = game.getPlayerById(playerId)

				Validator.isOwner(game, player)
				LiteratureController.startGame(game)

				LiteratureNamespace.to(gameCode).emit('game-updates', {
					code: 200,
					type: 'START'
				})
			} catch (err) {
				Logger.error('START-FAIL[%s][%s]', gameCode, playerId, {
					error: { ...err, msg: err.message, stack: err.stack }
				})
				LiteratureNamespace.to(socket.id).emit('game-updates', {
					type: 'START',
					code: err.code,
					name: err.name,
					message:
						err.name !== 'TypeError'
							? err.message
							: 'Unable to start game.'
				})
			}
		})

		socket.on('play-ask', (data) => {
			let card = data.card
			let gameCode = data.code

			try {
				let game = getGameData(gameCode)
				let fromPlayer = game.getPlayerById(data.fid)
				let toPlayer = game.getPlayerByPosition(data.tpos)

				Validator.isMyTurn(game, fromPlayer)
				LiteratureValidator.canAsk(fromPlayer, toPlayer, card)
				LiteratureController.askForCard(
					game,
					fromPlayer,
					toPlayer,
					card
				)
				LiteratureNamespace.to(socket.id).emit('play-ask', {
					code: 200,
					type: 'ASK'
				})
			} catch (err) {
				Logger.error('ASK-FAIL[%s][%s]', gameCode, data.fid, {
					error: { ...err, msg: err.message, stack: err.stack }
				})
				LiteratureNamespace.to(socket.id).emit('play-ask', {
					code: err.code,
					name: err.name,
					message:
						err.name !== 'TypeError'
							? err.message
							: 'Requested action failed.'
				})
			}
		})

		socket.on('play-declare', (data) => {
			let gameCode = data.code
			let playerId = data.pid
			let declaration = data.declaration

			try {
				let game = getGameData(gameCode)
				let from = game.getPlayerById(playerId)

				Validator.isMyTurn(game, from)
				let set = LiteratureValidator.checkSameSet(declaration)
				LiteratureController.declareSet(game, from, set, declaration)
				LiteratureNamespace.to(socket.id).emit('play-declare', {
					code: 200,
					type: 'DECLARE'
				})
			} catch (err) {
				Logger.error('DECLARE-FAIL[%s][%s]', gameCode, playerId, {
					error: { ...err, msg: err.message, stack: err.stack }
				})
				LiteratureNamespace.to(socket.id).emit('play-declare', {
					code: err.code,
					name: err.name,
					message:
						err.name !== 'TypeError'
							? err.message
							: 'Requested action failed.'
				})
			}
		})

		socket.on('play-transfer', (data) => {
			let gameCode = data.code
			let fromId = data.fid
			let toPos = data.tpos

			try {
				let game = getGameData(gameCode)
				let from = game.getPlayerById(fromId)

				Validator.isMyTurn(game, from)
				let to = game.getPlayerByPosition(toPos)

				Validator.areSameTeam(from, to)
				LiteratureValidator.didJustDeclare(game)
				LiteratureController.transferTurn(game, from, to)
				LiteratureNamespace.to(socket.id).emit('play-transfer', {
					code: 200,
					type: 'TRANSFER'
				})
			} catch (err) {
				Logger.error('TRANSFER-FAIL[%s][%s]', gameCode, fromId, {
					error: { ...err, msg: err.message, stack: err.stack }
				})
				LiteratureNamespace.to(socket.id).emit('play-transfer', {
					code: err.code,
					name: err.name,
					message:
						err.name !== 'TypeError'
							? err.message
							: 'Requested action failed.'
				})
			}
		})

		socket.on('chat', (data) => {
			let gameCode = data.code
			let pid = data.pid
			let message = data.message

			try {
				let game = getGameData(gameCode)
				let player = game.getPlayerById(pid)

				LiteratureController.addChat(message, game, player)
				LiteratureNamespace.to(gameCode).emit('chat', {
					code: 200,
					data: {
						message: message,
						player: {
							name: player.name,
							position: player.position
						}
					}
				})
			} catch (err) {
				Logger.error('CHAT-FAIL[%s][%s]', gameCode, pid, {
					error: { ...err, msg: err.message }
				})
				LiteratureNamespace.to(socket.id).emit('chat', {
					code: err.code,
					name: err.name,
					message:
						err.name !== 'TypeError'
							? err.message
							: 'Requested action failed.'
				})
			}
		})

		socket.on('disconnect', (reason) => {
			for (let [key, value] of socketMap.entries()) {
				if (value === socket.id) {
					Logger.info('DISCONNECT[%s]', key)
					socketMap.delete(key)
				}
			}
		})
	})
}

export { router as LiteratureRouter, setupLiteratureGame }
