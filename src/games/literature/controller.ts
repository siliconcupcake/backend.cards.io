import { Deck, Player, Game } from '../../engine'
import { GameService, PlayerService } from '../../services'

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
	let p = await PlayerService.getObjectById(id)
	let g = await GameService.getById(p.gameId)
	return { player: p, game: g }
}

var registerPlayer = async (id: string, name: string, pos: number) => {
	try {
		var player = await PlayerService.getById(id)
		player.name = name
		player.position = pos
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
	g.log('CREATE:' + owner.name)
	return g
}

var joinGame = async (game: Game, player: Player) => {
	await game.addPlayer(player)
	game.log('JOIN:' + player.name)
}

var leaveGame = async (game: Game, player: Player) => {
	await game.removePlayer(player)
	game.log('LEAVE:' + player.name)
}

var startGame = async (game: Game) => {
	game.prepareGame()
	game.log('START')
}

var destroyGame = async (game: Game) => {
	game.destroy()
}

var askForCard = async (game: Game, from: Player, to: Player, card: string) => {
	try {
		from.add(to.discard(card))
		game.log('TAKE:' + from.name + ':' + to.name + ':' + card)
		console.log(from.name + ' took ' + card + ' from ' + to.name)
	} catch (err) {
		game.log('ASK:' + from.name + ':' + to.name + ':' + card)
		console.log(from.name + ' asked ' + to.name + ' for ' + card)
		game.currentTurn = to.position
	}
}

var transferTurn = async (game: Game, from: Player, to: Player) => {
	game.currentTurn = to.position
	game.log('TRANSFER:' + from.name + ':' + to.name)
	console.log('Turn transferred to ' + to.name)
}

var declareSet = async (
	game: Game,
	player: Player,
	set: string,
	declaration: string[][]
) => {
	let playerTeam = player.position % 2
	let successfull = true
	for (let i = 0; i < declaration.length; i++) {
		let currentPos = 2 * (i + 1) - playerTeam
		for (let j = 0; j < declaration[i].length; j++) {
			let currentCard = declaration[i][j]
			let cardHolder = game.findCardWithPlayer(currentCard)
			if (cardHolder !== currentPos) {
				successfull = false
			}
			game.players[cardHolder].discard(currentCard)
		}
	}
	if (successfull) {
		player.score += 1
		game.log('DECLARE:' + player.name + ':' + set)
		console.log(player.name + ' correctly declared the ' + set)
	} else {
		let opponent = (player.position + 1) % game.players.length
		game.players[opponent].score += 1
		game.currentTurn = opponent
		game.log('DECLARE:' + game.players[opponent].name + ':' + set)
		console.log(player.name + ' incorrectly declared the ' + set)
	}
	game.processRound()
}
export {
	handleReconnect,
	registerPlayer,
	hostGame,
	joinGame,
	leaveGame,
	startGame,
	destroyGame,
	askForCard,
	transferTurn,
	declareSet
}
