import { Deck, Player, Game } from '../../engine'
import { GameService, PlayerService, ChatService } from '../../services'
import { Logger } from '../../util/logger'

var testLit = async () => {
	let po = await Player.build('Nandha', 2)
	let hostedGame = await hostGame(po)
	var p1 = await Player.build('Naven', 3)
	await hostedGame.addPlayer(p1)
	var p2 = await Player.build('Vivek', 1)
	await hostedGame.addPlayer(p2)

	hostedGame.prepareGame()
}

var handleReconnect = async (id: string) => {
	let p = await PlayerService.pluckById(id)
	let g = await GameService.pluckById(p.game)
	let c = await ChatService.getAllChats(p.game)
	return { player: p, game: g, chats: c }
}

var registerPlayer = async (id: string, name: string, pos: number) => {
	try {
		var player = await PlayerService.getObjectById(id)
		player.updateDetails(name, pos)
	} catch (err) {
		player = await Player.build(name, pos)
	}
	return player
}

var hostGame = async (owner: Player) => {
	const gameType = 'literature'
	const deck = new Deck()
	const minPlayers = 6
	const maxPlayers = 8
	const isTeamGame = true

	let g = await Game.build(
		gameType,
		deck,
		minPlayers,
		maxPlayers,
		isTeamGame,
		owner
	)
	g.decideStarter = function () {
		this._currentTurn = 1
	}
	g.isGameOver = function () {
		for (let i = 0; i < this._players.length; i++) {
			if (this._players[i].hand.length > 0) return false
		}
		return true
	}
	g.processRound = function () {
		if (this._isGameOver()) this.end()
		else {
			let isEvenDone = true,
				isOddDone = true
			for (let i = 0; i < this._players.length; i++) {
				let current = this._players[i]
				if (current.position % 2 == 0) {
					isEvenDone = isEvenDone && current.hand.length === 0
				} else {
					isOddDone = isOddDone && current.hand.length === 0
				}
			}
			if (isEvenDone) this.currentTurn = 1
			else if (isOddDone) this.currentTurn = 2
		}
	}
	g.activePlayers = function () {
		let activePlayers = []
		this._players.forEach((player) => {
			if (player.hand.length) activePlayers.push(player)
		})
		return activePlayers
	}
	g.log('CREATE:' + owner.name)
	return g
}

var joinGame = async (game: Game, player: Player) => {
	await game.addPlayer(player)
	game.log('JOIN:' + player.name)
}

var leaveGame = async (game: Game, player: Player) => {
	let success = await game.removePlayer(player)
	if (success) {
		game.log('LEAVE:' + player.name)
		return true
	} else return false
}

var startGame = (game: Game) => {
	game.prepareGame()
	game.log('START')
}

var askForCard = (game: Game, from: Player, to: Player, card: string) => {
	try {
		from.add(to.discard(card))
		game.log('TAKE:' + from.name + ':' + to.name + ':' + card)
		Logger.debug(
			'[%s] ' + from.name + ' took ' + card + ' from ' + to.name,
			game.code
		)
	} catch (err) {
		game.log('ASK:' + from.name + ':' + to.name + ':' + card)
		Logger.debug(
			'[%s] ' + from.name + ' asked ' + to.name + ' for ' + card,
			game.code
		)
		game.currentTurn = to.position
	}
}

var transferTurn = (game: Game, from: Player, to: Player) => {
	game.currentTurn = to.position
	game.log('TRANSFER:' + from.name + ':' + to.name)
	Logger.debug('[%s] Turn transferred to ' + to.name, game.code)
}

var declareSet = (
	game: Game,
	player: Player,
	set: string,
	declaration: string[][]
) => {
	game.log('ATTEMPT:' + player.name + ':' + set)
	let playerTeam = player.position % 2
	let successful = true
	for (let i = 0; i < declaration.length; i++) {
		let currentPos = 2 * (i + 1) - playerTeam
		for (let j = 0; j < declaration[i].length; j++) {
			let currentCard = declaration[i][j]
			let cardHolder = game.findCardWithPlayer(currentCard)
			if (cardHolder !== currentPos) {
				successful = false
			}
			game.getPlayerByPosition(cardHolder).discard(currentCard)
		}
	}
	if (successful) {
		player.score += 1
		game.log('DECLARE:' + player.name + ':' + set + ':CORRECT')
		Logger.debug(
			'[%s] ' + player.name + ' correctly declared the ' + set,
			game.code
		)
	} else {
		let opponent = game.getPlayerByPosition(
			(player.position + 1) % game.players.length
		)
		opponent.score += 1
		game.currentTurn = opponent.position
		game.log('DECLARE:' + player.name + ':' + set + ':INCORRECT')
		Logger.debug(
			'[%s] ' + player.name + ' incorrectly declared the ' + set,
			game.code
		)
	}
	game.processRound()
}

const addChat = (message: string, game: Game, player: Player) => {
	ChatService.addChat(message, game.id, player.id)
}

export {
	handleReconnect,
	registerPlayer,
	hostGame,
	joinGame,
	leaveGame,
	startGame,
	askForCard,
	transferTurn,
	declareSet,
	addChat
}
